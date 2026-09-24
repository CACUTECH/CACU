
'use server';

import { SupplierService } from '@/services/supplier-service';
import { revalidatePath } from 'next/cache';

export async function saveSupplierAction(data: any) {
  try {
    const service = new SupplierService();
    await service.upsertSupplier(data);
    revalidatePath('/settings/suppliers');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteSupplierAction(id: string) {
  try {
    const service = new SupplierService();
    await service.deleteSupplier(id);
    revalidatePath('/settings/suppliers');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
