import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { z } from 'zod';

export class UploadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const fileUuid = z.string().uuid();
export async function uploadContext() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new UploadError(401, 'Authentication required');
  let businessId: string;
  try { businessId = await getActiveBusinessIdAction(); }
  catch { throw new UploadError(403, 'Select an authorized business'); }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new UploadError(401, 'Authentication required');
  const base = process.env.CACU_UPLOAD_API_URL || process.env.CACU_ACCOUNTING_API_URL;
  if (!base) throw new UploadError(503, 'Secure uploads are not configured');
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new UploadError(503, 'Secure uploads require HTTPS');
  return { supabase, businessId, token: session.access_token, base: url.toString().replace(/\/$/, '') };
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new UploadError(403, 'Same-origin request required');
}
export async function boundedBody(request: Request, limit: number) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new UploadError(413, 'File exceeds the allowed size');
  if (!request.body) throw new UploadError(422, 'Choose a file');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new UploadError(413, 'File exceeds the allowed size'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { body.set(chunk,offset); offset+=chunk.byteLength; }
  return body;
}
export async function fileRequest(context: Awaited<ReturnType<typeof uploadContext>>, suffix: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${context.base}/api/v1/businesses/${context.businessId}/files${suffix}`, {
      ...options, headers: { ...options.headers, Authorization: `Bearer ${context.token}` },
      cache:'no-store', redirect:'error', signal:AbortSignal.timeout(45000),
    });
  } catch { throw new UploadError(503, 'File service unavailable'); }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const message = response.status < 500 && typeof failure.detail === 'string' && failure.detail.length < 200 ? failure.detail : 'File service unavailable';
    throw new UploadError(response.status, message);
  }
  return response;
}
export function uploadFailure(error: unknown) {
  return Response.json({ error: error instanceof UploadError ? error.message : 'File request unavailable' }, {
    status: error instanceof UploadError ? error.status : 503, headers: { 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' },
  });
}
