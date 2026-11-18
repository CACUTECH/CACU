import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BatchesPage from '@/app/inventory/batches/page';
import { ReceiveGoodsDialog } from '@/components/receive-goods-dialog';
import { batchesAction, batchTrackingAction, writeOffBatchAction } from '@/app/inventory/batches/actions';
import { listOutletsAction, receiveGoodsAction } from '@/app/purchases/actions';
import { whenExpires, type Batches } from '@/lib/batches';

jest.mock('@/app/inventory/batches/actions', () => ({ batchesAction: jest.fn(), batchTrackingAction: jest.fn(), writeOffBatchAction: jest.fn() }));
jest.mock('@/app/purchases/actions', () => ({ listOutletsAction: jest.fn(), receiveGoodsAction: jest.fn() }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'batch-key' });

const expired = { id: 'b1', batch_no: 'SOON', expiry: '2026-11-16', quantity: 4, received_on: '2026-10-01', state: 'expired' as const, days_left: -2 };
const view: Batches = { soon_days: 30, attention: [{ ...expired, item: 'Peak milk' }], items: [
  { id: 'milk', name: 'Peak milk', stock: 9, tracked: true, batches: [expired, { id: 'b2', batch_no: 'LATE', expiry: '2027-06-01', quantity: 5, received_on: '2026-11-01', state: 'ok', days_left: 195 }] },
  { id: 'rice', name: 'Rice', stock: 10, tracked: false, batches: [] }] };

beforeEach(() => { jest.clearAllMocks(); (batchesAction as jest.Mock).mockResolvedValue({ success: true, data: view }); });

test('expiry is described in plain words', () => {
  expect(whenExpires(expired)).toBe('Expired 2 days ago');
  expect(whenExpires({ ...expired, days_left: 1 })).toBe('Expires in 1 day');
  expect(whenExpires({ ...expired, days_left: 0 })).toBe('Expires today');
  expect(whenExpires({ ...expired, expiry: null, days_left: null })).toBe('No expiry recorded');
});

test('expired stock is listed and written off by batch; tracking is turned on per product', async () => {
  (writeOffBatchAction as jest.Mock).mockResolvedValue({ success: true, data: { adjustment: { status: 'posted' } } });
  (batchTrackingAction as jest.Mock).mockResolvedValue({ success: true, data: view });
  render(<BatchesPage />);
  expect(await screen.findByText('Expired 2 days ago')).toHaveClass('text-destructive');
  await userEvent.click(screen.getByRole('button', { name: 'Write off' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(writeOffBatchAction).toHaveBeenCalledWith('b1', 'batch-key', 4, 'Expired'));
  expect(await screen.findByText('4 of Peak milk written off.')).toBeInTheDocument();
  await userEvent.click(screen.getAllByLabelText('Track batches')[1]);
  await waitFor(() => expect(batchTrackingAction).toHaveBeenCalledWith('rice', true));
});

test('receiving a product that tracks batches asks for its expiry date', async () => {
  (listOutletsAction as jest.Mock).mockResolvedValue({ success: true, data: { outlets: [], own: null } });
  (receiveGoodsAction as jest.Mock).mockResolvedValue({ success: true, data: { id: 'r1' } });
  render(<ReceiveGoodsDialog orderId="o1" lines={[{ itemId: 'milk', name: 'Peak milk', remaining: 6, unitCost: '450' }]} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('Enter the expiry date for Peak milk.')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Batch number of Peak milk'), 'PM-2207');
  await userEvent.type(screen.getByLabelText('Expiry date of Peak milk'), '2027-03-31');
  await userEvent.click(screen.getByRole('button', { name: 'Receive goods' }));
  await waitFor(() => expect(receiveGoodsAction).toHaveBeenCalledWith(expect.objectContaining({
    lines: [{ itemId: 'milk', quantity: 6, unitCost: '450', expiry: '2027-03-31', batchNo: 'PM-2207' }] })));
});
