
'use server';

import { SupplierService, type SupplierInput } from '@/services/supplier-service';
import { revalidatePath } from 'next/cache';

export async function saveSupplierAction(data: SupplierInput) {
  try {
    const service = new SupplierService();
    await service.upsertSupplier(data);
    revalidatePath('/settings/suppliers');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Supplier update failed' };
  }
}

export async function deleteSupplierAction(id: string) {
  try {
    const service = new SupplierService();
    await service.deleteSupplier(id);
    revalidatePath('/settings/suppliers');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Supplier update failed' };
  }
}
