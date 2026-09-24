
'use server';

import { CustomerService } from '@/services/customer-service';
import { revalidatePath } from 'next/cache';

export async function saveCustomerAction(data: any) {
  try {
    const service = new CustomerService();
    await service.upsertCustomer(data);
    revalidatePath('/customers');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteCustomerAction(id: string) {
  try {
    const service = new CustomerService();
    await service.deleteCustomer(id);
    revalidatePath('/customers');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
