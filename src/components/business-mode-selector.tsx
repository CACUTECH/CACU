'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useBusiness } from '@/components/business-provider';
import { updateBusinessModeAction } from '@/app/settings/business/actions';
import { BUSINESS_MODES, canManageBusiness, isBusinessMode, isRouteAvailableInMode } from '@/lib/business-mode';
import type { BusinessType } from '@/lib/data';
import { Button } from '@/components/ui/button';

export function BusinessModeSelector({ compact = false }: { compact?: boolean }) {
  const { business, refresh } = useBusiness();
  if (!business || !isBusinessMode(business.business_type)) return null;
  return <ModeControl key={`${business.id}:${business.business_type}`} businessId={business.id}
    savedMode={business.business_type} canEdit={canManageBusiness(business.userRole)} compact={compact} refresh={refresh} />;
}

function ModeControl({ businessId, savedMode, canEdit, compact, refresh }: {
  businessId: string; savedMode: BusinessType; canEdit: boolean; compact: boolean; refresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<BusinessType>(savedMode);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  async function save() {
    setBusy(true); setError('');
    let result: Awaited<ReturnType<typeof updateBusinessModeAction>>;
    try {
      result = await updateBusinessModeAction({ businessId, expectedMode: savedMode, mode });
    } catch {
      setUncertain(true);
      setError('Save not confirmed. Retry the same change or refresh to check the saved mode.');
      setBusy(false);
      return;
    }
    setUncertain(false);
    if (!result.success) { setError(result.error); setBusy(false); return; }
    // The save is confirmed; a failed reload must not be reported as an uncertain save.
    if (!isRouteAvailableInMode(pathname, result.mode)) router.replace('/');
    try { await refresh(); } catch { setError('Mode saved. Refresh the page to update your workspace.'); }
    router.refresh();
    setBusy(false);
  }
  return <div className={compact ? 'max-w-xs space-y-1' : 'space-y-4'}>
    <div className="flex flex-wrap items-center gap-2">
      <label className={compact ? 'sr-only' : 'text-sm font-medium'} htmlFor={compact ? 'header-mode' : 'settings-mode'}>Business mode</label>
      <select id={compact ? 'header-mode' : 'settings-mode'} value={mode} disabled={!canEdit || busy || uncertain}
        onChange={event => { if (isBusinessMode(event.target.value)) { setMode(event.target.value); setError(''); } }}
        className="min-h-10 rounded-md border bg-background px-2 text-sm disabled:opacity-60">
        {BUSINESS_MODES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {canEdit && (mode !== savedMode || uncertain) && <Button size="sm" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : uncertain ? 'Retry save' : 'Save mode'}
      </Button>}
    </div>
    {!compact && <><p className="text-sm text-muted-foreground">{BUSINESS_MODES.find(option => option.value === mode)?.description}</p>
      <p className="text-sm text-muted-foreground">Saved for this business across devices. Existing records are preserved. {canEdit ? '' : 'Only Owners and Admins can change the mode.'}</p></>}
    {error && <div className="text-sm"><p role="alert">{error}</p><Button variant="link" disabled={busy} onClick={() => void refresh()}>Refresh saved mode</Button></div>}
  </div>;
}
