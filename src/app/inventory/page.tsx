import Link from 'next/link';
import { CatalogWorkspace } from '@/components/catalog-workspace';
import { usesPythonAccounting } from '@/lib/accounting-client';
export default async function InventoryPage() {
  // Approval rules apply once the books are live; before that, stock changes stay with Owners and Admins.
  const nativeBooks = await usesPythonAccounting().catch(() => false);
  return <div className="space-y-4">{nativeBooks && <Link href="/inventory/valuation" className="text-primary underline">Inventory valuation, goods receipts and NRV review</Link>}<CatalogWorkspace inventory nativeBooks={nativeBooks}/></div>;
}
