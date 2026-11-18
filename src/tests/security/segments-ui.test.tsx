import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SegmentsPage from '@/app/customers/segments/page';
import { previewSegmentAction, saveSegmentAction, segmentsAction, setTagsAction } from '@/app/customers/segments/actions';
import { describe as describeRules, rulesFrom, type Members } from '@/lib/segments';

jest.mock('@/app/customers/segments/actions', () => ({ segmentsAction: jest.fn(), previewSegmentAction: jest.fn(), saveSegmentAction: jest.fn(),
  deleteSegmentAction: jest.fn(), exportSegmentAction: jest.fn(), setTagsAction: jest.fn() }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'segment-key' });

const blank = { spentAmount: '', spentDays: '90', underAmount: '', underDays: '90', quietDays: '', recentDays: '', owes: '', tags: '' };
const ada = { id: 'ada', name: 'Ada Stores', phone: '08030000000', tags: [], owes: '63000.00', last_purchase: '2026-11-18', days_since: 0, spent_90_days: '3000.00', lifetime_value: '3000.00' };
const found: Members = { count: 1, lifetime_value: true, customers: [ada] };

beforeEach(() => {
  jest.clearAllMocks();
  (segmentsAction as jest.Mock).mockResolvedValue({ success: true, data: { segments: [], tags: ['church'], customers: 2, lifetime_value: true } });
});

test('the form becomes a rule set, and a rule set reads in plain words', () => {
  expect(rulesFrom(blank)).toBe('Fill in at least one rule.');
  expect(rulesFrom({ ...blank, spentAmount: '100000', quietDays: 'x' })).toBe('Check the "no purchase for" days.');
  const rules = rulesFrom({ ...blank, spentAmount: '100000', tags: 'church, wholesale' });
  expect(rules).toEqual({ spent_at_least: { amount: '100000', days: 90 }, tags_any: ['church', 'wholesale'] });
  expect(describeRules(rules as object)).toBe('spent ₦100,000 or more in 90 days, and tagged church or wholesale');
  expect(describeRules({ no_purchase_for: { days: 60 } })).toBe('no purchase in 60 days');
});

test('the owner sees who a segment picks out, saves it, and tags a customer', async () => {
  (previewSegmentAction as jest.Mock).mockResolvedValue({ success: true, data: found });
  (saveSegmentAction as jest.Mock).mockResolvedValue({ success: true, data: { ...found, id: 'segment-key' } });
  (setTagsAction as jest.Mock).mockResolvedValue({ success: true, data: { tags: ['church'] } });
  render(<SegmentsPage />);
  await userEvent.type(await screen.findByLabelText('Owes at least'), '50000');
  await userEvent.click(screen.getByRole('button', { name: 'See who is in it' }));
  await waitFor(() => expect(previewSegmentAction).toHaveBeenCalledWith({ owes_at_least: '50000' }));
  expect(await screen.findByText('Ada Stores')).toBeInTheDocument();
  expect(screen.getByText('₦63,000.00')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save segment' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give the segment a name.');
  await userEvent.type(screen.getByLabelText('Name'), 'Owing a lot');
  await userEvent.click(screen.getByRole('button', { name: 'Save segment' }));
  await waitFor(() => expect(saveSegmentAction).toHaveBeenCalledWith('segment-key', 'Owing a lot', { owes_at_least: '50000' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add tags' }));
  await userEvent.type(screen.getByLabelText('Tags for Ada Stores'), 'Church');
  await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
  await waitFor(() => expect(setTagsAction).toHaveBeenCalledWith('ada', ['Church']));
  expect(await screen.findByRole('button', { name: 'church' })).toBeInTheDocument();
});

test('lifetime value is hidden below the Chairman plan', async () => {
  (previewSegmentAction as jest.Mock).mockResolvedValue({ success: true, data: { ...found, lifetime_value: false, customers: [{ ...ada, lifetime_value: undefined }] } });
  render(<SegmentsPage />);
  await userEvent.type(await screen.findByLabelText('No purchase for'), '60');
  await userEvent.click(screen.getByRole('button', { name: 'See who is in it' }));
  expect(await screen.findByText('Lifetime value is part of the Chairman plan.')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Lifetime value' })).not.toBeInTheDocument();
});
