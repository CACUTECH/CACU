// Doc 08 §5: what a template allows, in the words the team screens use.
export const MODULES = [
  ['sales', 'Sales'], ['invoices', 'Invoices'], ['customers', 'Customers'], ['inventory', 'Stock and suppliers'],
  ['services', 'Bookings and jobs'], ['expenses', 'Expenses'], ['ledger', 'Books and reports'], ['banking', 'Banking'],
  ['hr', 'Staff and payroll'], ['settings', 'Team and settings'], ['billing', 'Billing'],
] as const;
export const ACTIONS = [
  ['view', 'See'], ['create', 'Add'], ['edit', 'Change'], ['approve', 'Approve'], ['post', 'Record'], ['export', 'Export'], ['delete', 'Delete'],
] as const;

/** One line per module the template touches, e.g. "Sales: See, Add, Record". Modules it cannot touch are left out. */
export function describeAccess(permissions: string[]): { module: string; label: string; actions: string }[] {
  const held = new Set(permissions);
  return MODULES.flatMap(([module, label]) => {
    const actions = ACTIONS.filter(([action]) => held.has(`${module}.${action}`)).map(([, name]) => name);
    return actions.length ? [{ module, label, actions: actions.join(', ') }] : [];
  });
}

/** Custom profiles cannot include billing changes: those stay with the owner. */
export function selectablePermission(code: string) {
  return !code.startsWith('billing.') || code === 'billing.view';
}

/** The templates someone may be given: not Owner (ownership has its own transfer), and legacy ones only when already held. */
export function assignable<T extends { code: string; legacy: boolean; id: string }>(templates: T[], current?: string | null) {
  return templates.filter(t => t.code !== 'owner' && (!t.legacy || t.id === current));
}
