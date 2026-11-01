jest.mock('@/app/ai/actions', () => ({ getAIChatStatusAction: jest.fn(), askAIQuestionAction: jest.fn() }));
jest.mock('lucide-react', () => ({ Sparkles: () => null, X: () => null }));
jest.mock('@/app/accounting/policies/actions', () => ({ loadCloseMetadataAction: jest.fn().mockResolvedValue({ success: false, error: 'Accounting API is not configured' }) }));
import { fireEvent, render, screen } from '@testing-library/react';
import { AIAssistant } from '@/components/ai-assistant';
import AccountingPoliciesPage from '@/app/accounting/policies/page';
import DeparturePage from '@/app/hr/termination/page';
import { AI_UNAVAILABLE_MESSAGE } from '@/lib/ai-availability';

test('assistant explains availability without asking for confidential inputs', () => {
  render(<AIAssistant />);
  fireEvent.click(screen.getByRole('button', { name: 'AI assistant availability' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(AI_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /analyze|send/i })).not.toBeInTheDocument();
});
test('accounting close explains unavailable data without claiming AI generation or delivery', async () => {
  render(<AccountingPoliciesPage />);
  expect(screen.getByRole('heading', { name: 'Accounting policies & financial close' })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Accounting API is not configured');
  expect(screen.queryByRole('button', { name: /generate|send/i })).not.toBeInTheDocument();
  expect(screen.getByText(/does not automatically certify IFRS compliance/)).toBeInTheDocument();
});

test('departure page points to the employee record and offers no letter generation', () => {
  render(<DeparturePage />);
  expect(screen.getByRole('heading', { name: 'Employee Departure' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to employees' })).toHaveAttribute('href', '/hr/employees');
  expect(screen.getByText(/AI departure letters are not available yet/)).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /generate|send/i })).not.toBeInTheDocument();
});
