import { createBusinessAction } from '@/app/setup/actions';
import { BusinessService } from '@/services/business-service';
import { selectBusinessAction } from '@/app/business-actions';
jest.mock('@/app/business-actions', () => ({ selectBusinessAction: jest.fn() }));
const input = { requestKey: '4be53d67-0ec1-4e9b-bf0a-2b2c484616d1', name: 'Test', type: 'PRODUCT' as const, sector: 'Retail', address: 'Test address', email: 'test@example.com', phone: '1', bank_name: 'Test', account_number: '1', account_name: 'Test' };
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());
test('committed creation with selection failure returns a recovery result', async () => {
  const create = jest.spyOn(BusinessService.prototype, 'createBusiness').mockResolvedValue({ id: 'business', replayed: false });
  (selectBusinessAction as jest.Mock).mockRejectedValueOnce(new Error('Membership read unavailable'));
  await expect(createBusinessAction(input)).resolves.toEqual({ success: true, businessId: 'business', selectionPending: true });
  expect(create).toHaveBeenCalledWith(input);
});
test('same-key replay can finish selection after membership already exists', async () => {
  jest.spyOn(BusinessService.prototype, 'createBusiness').mockResolvedValue({ id: 'business', replayed: true });
  (selectBusinessAction as jest.Mock).mockResolvedValueOnce(undefined);
  await expect(createBusinessAction(input)).resolves.toEqual({ success: true, businessId: 'business' });
  expect(selectBusinessAction).toHaveBeenCalledWith('business');
});
test('database membership rejection does not select another tenant', async () => {
  jest.spyOn(BusinessService.prototype, 'createBusiness').mockRejectedValue(new Error('User is already registered with a business. Select your existing business.'));
  await expect(createBusinessAction(input)).rejects.toThrow('already registered');
  expect(selectBusinessAction).not.toHaveBeenCalled();
});
