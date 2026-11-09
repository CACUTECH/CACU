// Download a full data export (Doc 10 E22 part 2, TEST-009): the accounting API checks settings.export in the active
// business and that the file is still kept; this only passes the ZIP on, never cached.
import { z } from 'zod';
import { AccountingRequestError, accountingDownload } from '@/lib/accounting-client';

export const runtime = 'nodejs';
const id = z.string().uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = id.safeParse((await params).id);
  if (!parsed.success) return Response.json({ error: 'Export not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try {
    const upstream = await accountingDownload(`exports/${parsed.data}/download`);
    const name = /filename="(cacu-export-[a-z0-9-]+\.zip)"/.exec(upstream.headers.get('content-disposition') ?? '')?.[1] ?? 'cacu-export.zip';
    return new Response(upstream.body, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const known = error instanceof AccountingRequestError;
    return Response.json({ error: known ? error.message : 'The file is unavailable. Try again.' },
      { status: known ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
