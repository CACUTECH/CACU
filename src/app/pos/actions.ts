
'use server';

import { SalesService } from '@/services/sales-service';
import { revalidatePath } from 'next/cache';

export async function processCheckoutAction(data: Parameters<SalesService['processCheckout']>[0]) {
  try {
    const service = new SalesService();
    const result = await service.processCheckout(data);
    
    // Invalidate caches to refresh stock and transaction lists
    revalidatePath('/pos');
    revalidatePath('/inventory');
    revalidatePath('/transactions');
    revalidatePath('/');
    
    return { success: true, saleId: result.saleId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Checkout failed' };
  }
}
