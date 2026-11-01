'use server';

import { revalidatePath } from 'next/cache';
import { ChartService, type AccountChange } from '@/services/chart-service';

export async function getChartOfAccountsAction() {
  try {
    return { success: true as const, data: await new ChartService().get() };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'The chart of accounts could not be loaded.' };
  }
}

export async function adoptDefaultChartAction(requestKey: string) {
  try {
    const data = await new ChartService().adopt(requestKey);
    revalidatePath('/accounting/chart-of-accounts');
    return { success: true as const, data };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'The accounts were not confirmed.' };
  }
}

export async function changeAccountAction(change: AccountChange, booksActive: boolean) {
  try {
    const data = await new ChartService().change(change, booksActive);
    revalidatePath('/accounting/chart-of-accounts');
    return { success: true as const, data };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'The change was not confirmed.' };
  }
}
