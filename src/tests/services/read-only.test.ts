import { READ_ONLY_MESSAGE, isReadOnlyRefusal } from '@/lib/read-only';
import { hrErrorMessage } from '@/lib/hr';
import { PERMISSION_MESSAGE, isPermissionRefusal } from '@/lib/permission';

test('a suspended workspace refusal is recognised and explained the same way everywhere (SUB-10)', () => {
  expect(isReadOnlyRefusal({ message: 'SUBSCRIPTION_READ_ONLY' })).toBe(true);
  expect([isReadOnlyRefusal({ message: 'PLAN_LIMIT users.max' }), isReadOnlyRefusal(null), isReadOnlyRefusal({})]).toEqual([false, false, false]);
  expect(READ_ONLY_MESSAGE).toBe('Your workspace is read-only until the subscription is paid. You can still record payments received and export.');
  expect(hrErrorMessage('SUBSCRIPTION_READ_ONLY')).toBe(READ_ONLY_MESSAGE);
});

test('a missing permission is recognised and explained the same way everywhere (Doc 08)', () => {
  expect(isPermissionRefusal({ message: 'PERMISSION_DENIED expenses.post' })).toBe(true);
  expect([isPermissionRefusal({ message: 'ACCESS_DENIED' }), isPermissionRefusal(null)]).toEqual([false, false]);
  expect(hrErrorMessage('PERMISSION_DENIED hr.edit')).toBe(PERMISSION_MESSAGE);
});
