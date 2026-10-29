
'use server';

import { LedgerEntryError, LedgerService } from '@/services/ledger-service';
import { revalidatePath } from 'next/cache';

export async function recordLedgerEntryAction(data: Parameters<LedgerService['recordEntry']>[0]) {
  try {
    const service = new LedgerService();
    await service.recordEntry(data);
    revalidatePath('/transactions');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ledger entry failed',
      uncertain: error instanceof LedgerEntryError ? error.uncertain : true };
  }
}

export async function readLedgerPageAction(page = 0) {
  return new LedgerService().listTransactionsPage(page);
}
