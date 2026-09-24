
'use server';

import { SalesService } from '@/services/sales-service';
import { revalidatePath } from 'next/cache';

export async function processCheckoutAction(data: any) {
  try {
    const service = new SalesService();
    const result = await service.processCheckout(data);
    
    // Invalidate caches to refresh stock and transaction lists
    revalidatePath('/pos');
    revalidatePath('/inventory');
    revalidatePath('/transactions');
    revalidatePath('/');
    
    return { success: true, saleId: result.saleId };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
