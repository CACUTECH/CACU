"use server";
import { InventoryService } from '@/services/inventory-service';
import { ManagementService, ManagementWriteError, type ManagementMutation } from '@/services/management-service';
import { AccountingRequestError } from '@/lib/accounting-client';
import { revalidatePath } from 'next/cache';
export async function readCatalogAction(query: Record<string, unknown> = {}) { return new ManagementService().read('catalog', query); }
export async function catalogOptionsAction() { return new ManagementService().read('options'); }
export async function mutateCatalogAction(input: ManagementMutation) {
    try {
        if (!['item.save', 'stock.adjust', 'category.save'].includes(input.operation))
            throw new Error('Unsupported catalog operation');
        const data = await new ManagementService().write(input);
        revalidatePath('/catalog');
        revalidatePath('/inventory');
        return { success: true as const, data };
    }
    catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Catalog update failed', uncertain: error instanceof ManagementWriteError ? error.uncertain : error instanceof AccountingRequestError ? error.status >= 500 : true };
    }
}
export async function saveCatalogItemAction(data: Record<string, unknown>) {
    try {
        const result = await new InventoryService().upsertItem(data);
        revalidatePath('/catalog');
        revalidatePath('/inventory');
        return { success: true, data: result };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Save failed' };
    }
}
export async function deleteCatalogItemAction(id: string, version?: number, requestKey?: string) {
    try {
        await new InventoryService().deleteItem(id, version, requestKey);
        revalidatePath('/catalog');
        revalidatePath('/inventory');
        return { success: true };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Archive failed' };
    }
}
