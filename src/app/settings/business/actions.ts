'use server';

import { revalidatePath } from 'next/cache';
import { BusinessModeError, BusinessModeService } from '@/services/business-mode-service';

export async function updateBusinessModeAction(input: { businessId: string; expectedMode: string; mode: string }) {
  try {
    const mode = await new BusinessModeService().update(input);
    revalidatePath('/', 'layout');
    return { success: true as const, mode };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof BusinessModeError ? error.message
        : 'Unable to save this mode. Refresh to check the current mode and your Owner/Admin access, then retry.',
    };
  }
}
