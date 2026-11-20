'use client';
// The VAT on a supplier's bill or receipt (E14 R3 part 2b). Shown only while the business charges VAT; the amount is
// what the supplier's document says, and the API checks it is no more than the standard rate allows.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { vatStatusAction } from '@/app/settings/taxes/actions';
import { mostVat, percent, type VatStatus } from '@/lib/vat';

export function useVatStatus(): VatStatus | null {
  const [status, setStatus] = React.useState<VatStatus | null>(null);
  React.useEffect(() => {
    let current = true;
    void Promise.resolve(vatStatusAction()).then(r => { if (current) setStatus(r?.success ? r.data : null); }).catch(() => {});
    return () => { current = false; };
  }, []);
  return status;
}

export function VatField({ status, value, onChange, base, inclusive, label, disabled }: {
  status: VatStatus | null; value: string; onChange: (value: string) => void; base: string; inclusive: boolean; label: string; disabled?: boolean;
}) {
  if (!status?.charging || !status.standard_rate) return null;
  const suggested = mostVat(base, status.standard_rate, inclusive);
  return <label className="space-y-1 text-sm"><span>{label}</span>
    <div className="flex gap-2"><Input aria-label={label} inputMode="decimal" placeholder="0.00" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />
      {suggested !== '0.00' && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(suggested)}>{percent(status.standard_rate)}: ₦{suggested}</Button>}</div>
    <span className="text-xs text-muted-foreground">As shown on the supplier&apos;s document. Leave empty if it shows no VAT.</span>
  </label>;
}
