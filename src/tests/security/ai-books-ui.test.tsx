import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AskYourBooksPage from '@/app/analytics/ask/page';
import { BooksAnswerView } from '@/components/ai-books-answer-view';
import { askAIBooksAction, getAIBooksStatusAction, notHelpfulAIBooksAction, setAIBooksAction } from '@/app/ai/books-actions';
import { AI_BOOKS_LABEL, type BooksAnswer } from '@/lib/ai-books';

jest.mock('@/app/business-actions', () => ({ getActiveBusinessIdAction: jest.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111') }));
jest.mock('@/app/ai/books-actions', () => ({ getAIBooksStatusAction: jest.fn(), setAIBooksAction: jest.fn(), askAIBooksAction: jest.fn(), notHelpfulAIBooksAction: jest.fn() }));

let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}` });

const status = (over = {}) => ({ ready: true, available: true, on: true, mayChange: false, paused: false, message: 'ok', allowance: '12 of 100 AI questions left this month', ...over });
const answer: BooksAnswer = { answer: 'This month you made ₦15,599.00 profit.', check: { status: 'passed', unchecked: [] }, tools: ['profit_summary'],
  sources: [{ screen: 'Reports', path: '/reports', period: '2026-11-01 to 2026-11-18' }], limitations: ['1 transfer (₦9,000.00) still waiting to be confirmed as received.'] };
beforeEach(() => jest.clearAllMocks());

test('AI-008/002/003/001: every answer is labelled, with its sources, limitations and unmatched figures', () => {
  render(<BooksAnswerView answer={{ ...answer, check: { status: 'flagged', unchecked: ['₦16,000'] },
    sources: [...answer.sources, { screen: 'Evil', path: '//example.com', period: 'x' }] }} />);
  expect(screen.getByText(AI_BOOKS_LABEL)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports');
  expect(screen.getByText(/2026-11-01 to 2026-11-18/)).toBeInTheDocument();
  expect(screen.getByText(/still waiting to be confirmed/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('could not match this figure');
  expect(screen.getByRole('alert')).toHaveTextContent('₦16,000');
  expect(screen.queryByRole('link', { name: 'Evil' })).not.toBeInTheDocument();   // never a link off CACU
});

test('answer text is shown as text, never as markup', () => {
  render(<BooksAnswerView answer={{ ...answer, answer: '<img src=x onerror=alert(1)>Profit' }} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
});

test('a member asks a question and sees the answer; a retry reuses the same request', async () => {
  (getAIBooksStatusAction as jest.Mock).mockResolvedValue(status());
  (askAIBooksAction as jest.Mock).mockResolvedValueOnce({ ok: false, code: 'failed', message: 'The answer could not be confirmed.' })
    .mockResolvedValueOnce({ ok: true, ...answer, allowance: '11 of 100 AI questions left this month' });
  render(<AskYourBooksPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Who owes my business money?' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  expect(await screen.findByText('This month you made ₦15,599.00 profit.')).toBeInTheDocument();
  const [first, second] = (askAIBooksAction as jest.Mock).mock.calls.map(c => c[0]);
  expect(second).toEqual(first);
  expect(first.question).toBe('Who owes my business money?');
  expect(screen.getByText('11 of 100 AI questions left this month')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /switch/i })).not.toBeInTheDocument();   // not the owner
});

test('"not helpful" on an answer sends that answer\'s request and a reason, offers no text box, and retries after a failure', async () => {
  (getAIBooksStatusAction as jest.Mock).mockResolvedValue(status());
  (askAIBooksAction as jest.Mock).mockResolvedValue({ ok: true, ...answer });
  (notHelpfulAIBooksAction as jest.Mock).mockResolvedValueOnce({ ok: false, message: 'Your feedback could not be saved. Try again.' })
    .mockResolvedValueOnce({ ok: true });
  render(<AskYourBooksPage />);
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'How much profit did I make this month?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Not helpful' }));
  const reasons = screen.getByRole('group', { name: 'Why was this answer not helpful?' });
  expect(reasons.querySelector('textarea, input')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'The figures look wrong' }));
  expect(await screen.findByText('Your feedback could not be saved. Try again.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'The figures look wrong' }));
  expect(await screen.findByText(/CACU reviews this feedback each week/)).toBeInTheDocument();
  const asked = (askAIBooksAction as jest.Mock).mock.calls[0][0];
  expect((notHelpfulAIBooksAction as jest.Mock).mock.calls.map(c => c[0])).toEqual([1, 2].map(() =>
    ({ businessId: '11111111-1111-4111-8111-111111111111', requestKey: asked.requestKey, reason: 'wrong_figures' })));
  expect(screen.queryByRole('button', { name: 'Not helpful' })).not.toBeInTheDocument();
});

test('AI-012: the owner sees what is sent and switches it on; others are told to ask the owner', async () => {
  (getAIBooksStatusAction as jest.Mock).mockResolvedValueOnce(status({ ready: false, on: false, mayChange: true, message: 'off' }))
    .mockResolvedValueOnce(status({ mayChange: true }));
  (setAIBooksAction as jest.Mock).mockResolvedValue({ ok: true });
  render(<AskYourBooksPage />);
  expect(await screen.findByText(/goes to OpenAI with your business type/)).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Switch on for this business' }));
  await waitFor(() => expect(setAIBooksAction).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', true));
  expect(await screen.findByRole('textbox')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Switch off' })).toBeInTheDocument();
});

test('a non-owner of a business that is off is told to ask the owner, with nothing to type in', async () => {
  (getAIBooksStatusAction as jest.Mock).mockResolvedValue(status({ ready: false, on: false, mayChange: false, message: 'Answers from your books are not switched on for this business.' }));
  render(<AskYourBooksPage />);
  expect(await screen.findByText('Ask the business owner to switch this on.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /switch/i })).not.toBeInTheDocument();
});

test('before gate G4 the page says it is not available, and offers no switch or question box', async () => {
  (getAIBooksStatusAction as jest.Mock).mockResolvedValue(status({ ready: false, available: false, on: false, mayChange: true, message: 'Answers from your books are not available yet.' }));
  render(<AskYourBooksPage />);
  expect(await screen.findByText('Answers from your books are not available yet.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /switch/i })).not.toBeInTheDocument();
});
