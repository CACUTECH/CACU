"use client";
import type { CollectionAccounts } from '@/lib/collection-accounts';
import { Label } from '@/components/ui/label';

type Props = { method: 'Cash' | 'Transfer'; bankAccountId: string; choices: CollectionAccounts;
  onMethodChange: (method: 'Cash' | 'Transfer') => void; onBankChange: (id: string) => void; disabled?: boolean };

export function CollectionAccountPicker({ method, bankAccountId, choices, onMethodChange, onBankChange, disabled }: Props) {
  return <div className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor="collection-method">Payment method</Label>
      <select id="collection-method" value={method} disabled={disabled} onChange={event => onMethodChange(event.target.value as 'Cash' | 'Transfer')}
        className="h-11 w-full rounded-md border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="Cash">Cash</option><option value="Transfer">Transfer</option>
      </select>
    </div>
    {method === 'Transfer' && choices.native ? <div className="space-y-2">
      <Label htmlFor="collection-bank">Receiving bank account</Label>
      <select id="collection-bank" value={bankAccountId} disabled={disabled} onChange={event => onBankChange(event.target.value)} required
        className="h-11 w-full rounded-md border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">Select the account that received the payment</option>
        {choices.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      {choices.accounts.length === 0 && <p role="status" className="text-sm text-muted-foreground">No receiving bank accounts are available. Set up a reviewed bank account before recording a Transfer payment.</p>}
    </div> : null}
    <p className="text-sm text-muted-foreground">Record manual payments only after confirming receipt. Card collection is unavailable.</p>
  </div>;
}
