import type { BusinessType } from '@/lib/data';

export const BUSINESS_MODES: { value: BusinessType; label: string; description: string }[] = [
  { value: 'PRODUCT', label: 'Product', description: 'Inventory and POS checkout. Appointments and work orders are hidden.' },
  { value: 'SERVICE', label: 'Service', description: 'Appointments, work orders and invoicing. POS checkout is hidden.' },
  { value: 'HYBRID', label: 'Hybrid', description: 'Products and services, including POS, appointments and work orders.' },
];

export function isBusinessMode(value: unknown): value is BusinessType {
  return value === 'PRODUCT' || value === 'SERVICE' || value === 'HYBRID';
}

export function isRouteAvailableInMode(path: string, mode: unknown) {
  const within = (route: string) => path === route || path.startsWith(`${route}/`);
  if (within('/pos')) return mode === 'PRODUCT' || mode === 'HYBRID';
  if (within('/appointments') || within('/jobs')) return mode === 'SERVICE' || mode === 'HYBRID';
  return true;
}

export function canManageBusiness(role: unknown) {
  return role === 'owner' || role === 'admin';
}
