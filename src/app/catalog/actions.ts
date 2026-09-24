
'use server';

import { InventoryService } from '@/services/inventory-service';
import { revalidatePath } from 'next/cache';

export async function saveCatalogItemAction(data: any) {
  try {
    const service = new InventoryService();
    await service.upsertItem(data);
    revalidatePath('/catalog');
    revalidatePath('/inventory');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteCatalogItemAction(id: string) {
  try {
    const service = new InventoryService();
    await service.deleteItem(id);
    revalidatePath('/catalog');
    revalidatePath('/inventory');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
