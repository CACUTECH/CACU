
'use server';

import { HRService } from '@/services/hr-service';
import { revalidatePath } from 'next/cache';

export async function logAttendanceAction(employeeId: string, type: 'IN' | 'OUT') {
  try {
    const service = new HRService();
    await service.logAttendance(employeeId, type);
    revalidatePath('/hr/attendance');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
