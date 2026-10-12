'use server';
import { accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { CollectionAccount, CollectionAccounts } from '@/lib/collection-accounts';

export async function getCollectionAccountsAction(): Promise<CollectionAccounts> {
  if (!(await usesPythonAccounting())) return { native: false, accounts: [] };
  return { native: true, accounts: await accountingRequest<CollectionAccount[]>('collection-accounts') };
}
