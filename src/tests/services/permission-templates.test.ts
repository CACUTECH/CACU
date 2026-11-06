import { assignable, describeAccess, selectablePermission } from '@/lib/permission-templates';

test('access is described per area in Doc 08 order, leaving out areas the template cannot touch', () => {
  expect(describeAccess(['sales.post', 'sales.view', 'invoices.view', 'billing.view'])).toEqual([
    { module: 'sales', label: 'Sales', actions: 'See, Record' },
    { module: 'invoices', label: 'Invoices', actions: 'See' },
    { module: 'billing', label: 'Billing', actions: 'See' },
  ]);
});

test('custom profiles may see billing but never change it', () => {
  expect(['billing.view', 'billing.edit', 'billing.post', 'sales.delete'].map(selectablePermission)).toEqual([true, false, false, true]);
});

test('Owner is never offered, and legacy templates only to someone who already has one', () => {
  const templates = [{ id: '1', code: 'owner', legacy: false }, { id: '2', code: 'cashier', legacy: false }, { id: '3', code: 'editor_legacy', legacy: true }];
  expect(assignable(templates).map(t => t.code)).toEqual(['cashier']);
  expect(assignable(templates, '3').map(t => t.code)).toEqual(['cashier', 'editor_legacy']);
});
