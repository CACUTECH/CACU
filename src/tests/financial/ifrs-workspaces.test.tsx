import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ValuationPage from '@/app/inventory/valuation/page';
import { loadValuationAction, valuationCommandAction } from '@/app/accounting/policies/actions';
jest.mock('@/app/accounting/policies/actions', () => ({ loadValuationAction: jest.fn(), valuationCommandAction: jest.fn() }));
Object.defineProperty(globalThis.crypto,'randomUUID',{ configurable:true,value:() => '3a571056-45cf-4239-96bb-331e35c39b65' });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadValuationAction).mockResolvedValue({ success:true,data:{ inventory:{ formula:null,allowance_account_id:null,items:[],events:[] },accounts:[{ id:'allowance',name:'NRV allowance',code:'1301',type:'CURRENT_ASSET',flow_section:'operating' }],suppliers:[],cash_classifications:[] } });
});
test('an uncertain valuation write freezes edits and replays the original request',async () => {
  jest.mocked(valuationCommandAction).mockResolvedValueOnce({ success:false,error:'Response lost',uncertain:true }).mockResolvedValueOnce({ success:true,data:{} });
  render(<ValuationPage />);
  await screen.findByRole('heading',{name:'Approve costing policy'});
  fireEvent.change(screen.getByLabelText('Allowance account'),{target:{value:'allowance'}});
  fireEvent.change(screen.getByLabelText('Accountant-approved policy reference'),{target:{value:'Signed accountant policy reference REF-01'}});
  fireEvent.click(screen.getByRole('button',{name:'Adopt moving weighted average'}));
  await screen.findByRole('button',{name:'Retry saved request'});
  expect(screen.getByLabelText('Allowance account')).toBeDisabled();
  const original=jest.mocked(valuationCommandAction).mock.calls[0];
  fireEvent.click(screen.getByRole('button',{name:'Retry saved request'}));
  await waitFor(() => expect(valuationCommandAction).toHaveBeenCalledTimes(2));
  expect(jest.mocked(valuationCommandAction).mock.calls[1]).toEqual(original);
  expect(original).toEqual(['policy',expect.objectContaining({request_key:'3a571056-45cf-4239-96bb-331e35c39b65',formula:'moving_weighted_average',allowance_account_id:'allowance'})]);
  await screen.findByText(/stock, valuation and ledger changes were saved together/);
});
