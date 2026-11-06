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
      <Label htmlFor="collection-bank">Bank account you expect it in (optional)</Label>
      <select id="collection-bank" value={bankAccountId} disabled={disabled} onChange={event => onBankChange(event.target.value)}
        className="h-11 w-full rounded-md border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">Not sure yet: choose when confirming</option>
        {choices.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <p role="status" className="text-sm text-muted-foreground">Transfers wait for confirmation. The owner confirms the money arrived, or marks it not received, on Daily reconciliation. Until then it does not count as money in the bank.</p>
    </div> : null}
    <p className="text-sm text-muted-foreground">{method === 'Transfer' && choices.native ? 'Card collection is unavailable.' : 'Record manual payments only after confirming receipt. Card collection is unavailable.'}</p>
  </div>;
}
