"use client";
import { Button } from '@/components/ui/button';

export function MutationFeedback({ error, message, uncertain, busy, onRetry }: {
  error: string; message: string; uncertain: boolean; busy: boolean; onRetry: () => void;
}) {
  return <>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {uncertain && <div className="space-y-2 rounded-md border p-3 text-sm">
      <p>Retry sends the original change, so it cannot be applied twice.</p>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRetry}>{busy ? 'Checking...' : 'Retry original change'}</Button>
    </div>}
  </>;
}
