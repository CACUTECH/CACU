
'use server';

import { LedgerService } from '@/services/ledger-service';
import { revalidatePath } from 'next/cache';

export async function recordLedgerEntryAction(data: any) {
  try {
    const service = new LedgerService();
    await service.recordEntry(data);
    revalidatePath('/transactions');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
