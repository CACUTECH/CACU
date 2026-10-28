import { updateBusinessModeAction } from '@/app/settings/business/actions';
import { BusinessModeError, BusinessModeService } from '@/services/business-mode-service';
import { revalidatePath } from 'next/cache';
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/services/business-mode-service', () => ({ ...jest.requireActual('@/services/business-mode-service'), BusinessModeService: jest.fn() }));
const update = jest.fn();
beforeEach(() => { jest.clearAllMocks(); (BusinessModeService as jest.Mock).mockImplementation(() => ({ update })); });
const input = { businessId: 'active-business', expectedMode: 'PRODUCT', mode: 'HYBRID' };

test('confirmed save revalidates the workspace layout', async () => {
  update.mockResolvedValue('HYBRID');
  await expect(updateBusinessModeAction(input)).resolves.toEqual({ success: true, mode: 'HYBRID' });
  expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
});
test('reviewed service messages reach the browser', async () => {
  update.mockRejectedValue(new BusinessModeError('Business mode changed elsewhere. Refresh before saving again.'));
  await expect(updateBusinessModeAction(input)).resolves.toEqual({ success: false, error: 'Business mode changed elsewhere. Refresh before saving again.' });
  expect(revalidatePath).not.toHaveBeenCalled();
});
test('unexpected failures are replaced with a generic message', async () => {
  update.mockRejectedValue(new Error('private session detail'));
  const result = await updateBusinessModeAction(input);
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private session detail');
});
