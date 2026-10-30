import { CatalogWorkspace } from '@/components/catalog-workspace';
import { usesPythonAccounting } from '@/lib/accounting-client';
export default async function InventoryPage() {
  // Approval rules apply once the books are live; before that, stock changes stay with Owners and Admins.
  const nativeBooks = await usesPythonAccounting().catch(() => false);
  return <CatalogWorkspace inventory nativeBooks={nativeBooks}/>;
}
