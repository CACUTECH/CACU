
'use server';

import { HRService } from '@/services/hr-service';
import { revalidatePath } from 'next/cache';

export async function addEmployeeAction(data: any) {
  try {
    const service = new HRService();
    await service.addEmployee(data);
    revalidatePath('/hr/employees');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
