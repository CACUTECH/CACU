// Full data export (Doc 10 E22 part 2, FR-192): what the settings page shows about each export.
export type DataExport = { id: string; status: 'queued' | 'running' | 'ready' | 'failed' | 'expired'; requested_at: string;
  finished_at: string | null; expires_at: string | null; file_name: string | null; size_bytes: number | null;
  manifest: { files: number; rows: number } | null; error: string | null };

export const EXPORT_STATUS: Record<DataExport['status'], string> = {
  queued: 'Waiting to be prepared', running: 'Being prepared', ready: 'Ready to download', failed: 'Not prepared', expired: 'Deleted after 7 days',
};

export function fileSize(bytes: number | null) {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
