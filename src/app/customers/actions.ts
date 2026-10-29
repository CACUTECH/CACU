
'use server';

import { CustomerService, type CustomerInput } from '@/services/customer-service';
import { revalidatePath } from 'next/cache';

export async function saveCustomerAction(data: CustomerInput) {
  try {
    const service = new CustomerService();
    await service.upsertCustomer(data);
    revalidatePath('/customers');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Customer update failed' };
  }
}

export async function deleteCustomerAction(id: string) {
  try {
    const service = new CustomerService();
    await service.deleteCustomer(id);
    revalidatePath('/customers');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Customer update failed' };
  }
}
