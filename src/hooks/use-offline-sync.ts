// Sends this person's offline sales when the device is online: on load, when the connection returns, and every minute.
// A sale the server has posted leaves the device; one waiting for review is marked and kept; a refusal is kept with its
// reason so nothing captured offline is lost.
import * as React from 'react';
import { syncOfflineExpenseAction, syncOfflineSaleAction } from '@/app/pos/offline-actions';
import { forgetSale, markSale, online, salesOnDevice, type OutboxEntry } from '@/lib/offline-outbox';

export function useOfflineSync(businessId: string | null, userId: string | null) {
  const [entries, setEntries] = React.useState<OutboxEntry[]>([]);
  const [connected, setConnected] = React.useState(online());
  const [syncing, setSyncing] = React.useState(false);
  const busy = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (!businessId) return;
    try { setEntries(await salesOnDevice(businessId)); } catch { setEntries([]); }
  }, [businessId]);

  const syncNow = React.useCallback(async () => {
    if (!businessId || !userId || busy.current || !online()) return;
    busy.current = true; setSyncing(true);
    try {
      for (const entry of await salesOnDevice(businessId)) {
        if (entry.user_id !== userId || entry.status !== 'pending') continue;
        const result = entry.kind === 'expense' ? await syncOfflineExpenseAction(entry.payload) : await syncOfflineSaleAction(entry.payload);
        if (result.success && result.data.status === 'posted') await forgetSale(entry.key);
        else if (result.success) await markSale(entry.key, { status: 'review', detail: result.data.detail ?? null });
        else if (result.uncertain) { await markSale(entry.key, { attempts: entry.attempts + 1, detail: result.error }); break; }
        else await markSale(entry.key, { status: 'failed', detail: result.error, attempts: entry.attempts + 1 });
      }
    } catch { /* storage unavailable: nothing to send */ }
    finally { busy.current = false; setSyncing(false); await refresh(); }
  }, [businessId, userId, refresh]);

  React.useEffect(() => {
    void refresh(); void syncNow();
    const up = () => { setConnected(true); void syncNow(); };
    const down = () => setConnected(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    const timer = window.setInterval(() => { void syncNow(); }, 60000);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); window.clearInterval(timer); };
  }, [refresh, syncNow]);

  return { entries, connected, syncing, syncNow, refresh };
}
