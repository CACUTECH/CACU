"use client";
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mutateHRAction } from '@/app/hr/actions';
import type { HRMutation, HROperation } from '@/lib/hr';

/**
 * Sends one HR change at a time. An unconfirmed change keeps its request key so a retry
 * replays the original request instead of applying a second one.
 */
export function useHRMutation() {
  const router = useRouter();
  const pending = useRef<{ input: HRMutation; success: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function send() {
    if (!pending.current) return null;
    const { input, success } = pending.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await mutateHRAction(input);
      if (!result.success) {
        if (!result.uncertain) { pending.current = null; setUncertain(false); }
        else setUncertain(true);
        setError(result.error);
        return null;
      }
      pending.current = null; setUncertain(false); setMessage(success);
      router.refresh();
      return result.data;
    } catch {
      setUncertain(true);
      setError('The HR change was not confirmed. Retry to check whether it was applied.');
      return null;
    } finally { setBusy(false); }
  }

  async function run(operation: HROperation, details: Record<string, unknown>, options: { recordId?: string | null; version?: number | null; success?: string } = {}) {
    if (busy) return null;
    if (pending.current) {
      setError('An earlier change is unconfirmed. Retry it before starting another.');
      return null;
    }
    pending.current = { input: { request_key: crypto.randomUUID(), operation, record_id: options.recordId ?? null, expected_version: options.version ?? null, details },
      success: options.success || 'Saved.' };
    return send();
  }

  async function retry() {
    if (busy) return null;
    return send();
  }

  return { run, retry, busy, uncertain, error, message, setError };
}
