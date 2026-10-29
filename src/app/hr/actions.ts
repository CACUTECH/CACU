'use server';

import { revalidatePath } from 'next/cache';
import { HRError, HRService } from '@/services/hr-service';
import type { HRMutation, HRResult } from '@/lib/hr';

export async function mutateHRAction(input: HRMutation): Promise<HRResult> {
  try {
    const data = await new HRService().write(input);
    revalidatePath('/hr', 'layout');
    return { success: true, data };
  } catch (error) {
    if (error instanceof HRError) return { success: false, error: error.message, uncertain: error.uncertain };
    return { success: false, error: 'The HR change was not confirmed. Retry to check whether it was applied.', uncertain: true };
  }
}
