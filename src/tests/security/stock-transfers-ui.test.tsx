import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransfersPage from '@/app/purchases/transfers/page';
import TransferPage from '@/app/purchases/transfers/[id]/page';
import { getTransferAction, listOutletsAction, listTransfersAction, outletStockAction, receiveTransferAction, sendStockAction } from '@/app/purchases/actions';

jest.mock('@/app/purchases/actions', () => ({ listOutletsAction: jest.fn(), outletStockAction: jest.fn(), listTransfersAction: jest.fn(),
  getTransferAction: jest.fn(), sendStockAction: jest.fn(), receiveTransferAction: jest.fn() }));
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 't1' }) }));
jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.setTimeout(20000);
let keys = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `key-${++keys}` });

const outlets = [{ id: 'ikeja', name: 'Ikeja shop', is_active: true }, { id: 'yaba', name: 'Yaba shop', is_active: true }];
const stock = { outlets, items: [{ id: 'rice', name: 'Rice', total: 15, outlets: { ikeja: 15, yaba: 0 }, in_transit: 0 }] };
const transfer = { id: 't1', number: 'TR-0001', status: 'in_transit' as const, from_location: 'ikeja', to_location: 'yaba', from_name: 'Ikeja shop', to_name: 'Yaba shop',
  note: '', sent_on: '2026-11-10', received_on: null, receive_note: null, loss_value: null, items: 1,
  lines: [{ item_id: 'rice', name: 'Rice', quantity: 5, received_quantity: null, lost_quantity: null }] };

beforeEach(() => jest.clearAllMocks());

test('stock is sent from an outlet that holds it to another open outlet', async () => {
  (listTransfersAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  (outletStockAction as jest.Mock).mockResolvedValue({ success: true, data: stock });
  (listOutletsAction as jest.Mock).mockResolvedValue({ success: true, data: { outlets, own: null } });
  (sendStockAction as jest.Mock).mockResolvedValueOnce({ success: true, data: transfer });
  render(<TransfersPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Send stock' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the outlet sending the goods.');
  await userEvent.selectOptions(screen.getByLabelText('From'), 'ikeja');
  await userEvent.selectOptions(screen.getByLabelText('To'), 'yaba');
  await userEvent.selectOptions(screen.getByLabelText('Add a product'), 'rice');
  await userEvent.clear(screen.getByLabelText('Quantity of Rice to send')); await userEvent.type(screen.getByLabelText('Quantity of Rice to send'), '16');
  expect(screen.getByRole('alert')).toHaveTextContent('Send between 1 and 15 Rice from Ikeja shop.');
  await userEvent.clear(screen.getByLabelText('Quantity of Rice to send')); await userEvent.type(screen.getByLabelText('Quantity of Rice to send'), '5');
  await userEvent.click(screen.getAllByRole('button', { name: 'Send stock' }).at(-1)!);
  await waitFor(() => expect(sendStockAction).toHaveBeenCalledWith({ requestKey: expect.any(String), fromLocation: 'ikeja', toLocation: 'yaba', note: '',
    lines: [{ itemId: 'rice', quantity: 5 }] }));
  expect(await screen.findByText(/TR-0001 sent to Yaba shop/)).toBeInTheDocument();
});

test('a person tied to an outlet sends only from it', async () => {
  (listTransfersAction as jest.Mock).mockResolvedValue({ success: true, data: [transfer] });
  (outletStockAction as jest.Mock).mockResolvedValue({ success: true, data: stock });
  (listOutletsAction as jest.Mock).mockResolvedValue({ success: true, data: { outlets, own: 'ikeja' } });
  render(<TransfersPage />);
  expect(await screen.findByText('In transit')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Send stock' }));
  expect(screen.getByLabelText('From')).toHaveValue('ikeja');
  expect(screen.getByLabelText('From')).toBeDisabled();
});

test('receiving counts what arrived, and anything missing needs a reason', async () => {
  (getTransferAction as jest.Mock).mockResolvedValue({ success: true, data: transfer });
  (receiveTransferAction as jest.Mock).mockResolvedValueOnce({ success: true, data: { ...transfer, status: 'received', received_on: '2026-11-10', loss_value: '50000.00',
    receive_note: 'One bag torn', lines: [{ ...transfer.lines[0], received_quantity: 4, lost_quantity: 1 }] } });
  render(<TransferPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Receive' }));
  expect(screen.getByLabelText('Rice arrived')).toHaveValue('5');
  await userEvent.clear(screen.getByLabelText('Rice arrived')); await userEvent.type(screen.getByLabelText('Rice arrived'), '4');
  expect(screen.getByText('1 Rice missing.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Say why some goods did not arrive.');
  await userEvent.type(screen.getByLabelText('What happened'), 'One bag torn');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm what arrived' }));
  await waitFor(() => expect(receiveTransferAction).toHaveBeenCalledWith('t1', { requestKey: expect.any(String), note: 'One bag torn',
    lines: [{ itemId: 'rice', receivedQuantity: 4 }] }));
  expect(await screen.findByText(/₦50,000.00 of goods lost on the way came out of stock/)).toBeInTheDocument();
});
