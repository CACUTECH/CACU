import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import type { components } from '@/lib/accounting-contract';

type Draft = components['schemas']['JournalDraft'];
type Validation = components['schemas']['JournalValidation'];

/** Server-only adapter. Validation is not a posting operation. */
export async function validateAccountingJournal(draft: Draft): Promise<Validation> {
  const base = process.env.CACU_ACCOUNTING_API_URL;
  if (!base) throw new Error('Accounting API is not configured');
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) {
    throw new Error('Accounting API requires HTTPS');
  }
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Authentication required');
  const businessId = await getActiveBusinessIdAction();
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error('Valid session required');
  const response = await fetch(new URL(`/v1/businesses/${encodeURIComponent(businessId)}/journals/validate`, url), {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(draft), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Accounting validation failed (${response.status})`);
  return response.json() as Promise<Validation>;
}