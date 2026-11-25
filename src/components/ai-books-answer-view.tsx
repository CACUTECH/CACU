"use client";
// One answer from the books (Doc 15): the AI label (AI-008), the answer as plain text, any figure CACU could not match
// to the books (AI-001), what the figures cannot see (AI-003) and links to the screens they came from (AI-002).
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AI_BOOKS_LABEL, NOT_HELPFUL_REASONS, type BooksAnswer, type NotHelpfulReason } from '@/lib/ai-books';

const appPath = (path: string) => /^\/(?!\/)[a-z0-9\-/]{0,80}$/.test(path);

export function BooksAnswerView({ answer }: { answer: BooksAnswer }) {
  return <div className="space-y-3 rounded-lg border p-4 text-sm">
    <p className="text-xs font-medium text-muted-foreground">{AI_BOOKS_LABEL}</p>
    <p className="whitespace-pre-wrap break-words">{answer.answer}</p>
    {answer.check.status === 'flagged' && <div role="alert" className="rounded-md border border-amber-500 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <p className="font-medium">CACU could not match {answer.check.unchecked.length === 1 ? 'this figure' : 'these figures'} to your books:</p>
      <p className="tabular-nums">{answer.check.unchecked.join(', ')}</p>
      <p>Check them on the screens below before relying on them.</p>
    </div>}
    {answer.limitations.length > 0 && <div>
      <p className="font-medium">What these figures cannot see</p>
      <ul className="list-disc pl-5">{answer.limitations.map(l => <li key={l}>{l}</li>)}</ul>
    </div>}
    {answer.sources.length > 0 && <div>
      <p className="font-medium">Where the figures come from</p>
      <ul className="space-y-1">{answer.sources.map(s => <li key={`${s.path}|${s.period}`}>
        {appPath(s.path) ? <Link className="underline" href={s.path}>{s.screen}</Link> : s.screen}<span className="text-muted-foreground">, {s.period}</span>
      </li>)}</ul>
    </div>}
    {answer.sources.length === 0 && <p className="text-muted-foreground">No figures from your books were looked up for this answer.</p>}
  </div>;
}

/** "Not helpful" for CACU's weekly review (Doc 15 monitoring): one reason from a fixed list, never any text. */
export function NotHelpful({ onSend }: { onSend: (reason: NotHelpfulReason) => Promise<{ ok: boolean; message?: string }> }) {
  const [state, setState] = React.useState<'idle' | 'choosing' | 'saving' | 'sent'>('idle');
  const [error, setError] = React.useState('');
  const send = async (reason: NotHelpfulReason) => {
    setState('saving'); setError('');
    try {
      const result = await onSend(reason);
      if (result.ok) { setState('sent'); return; }
      setError(result.message ?? 'Your feedback could not be saved. Try again.');
    } catch { setError('Your feedback could not be saved. Try again.'); }
    setState('choosing');
  };
  if (state === 'sent') return <p role="status" className="text-xs text-muted-foreground">Thank you. CACU reviews this feedback each week. It keeps your reason, not your question or the answer.</p>;
  if (state === 'idle') return <Button type="button" size="sm" variant="ghost" onClick={() => setState('choosing')}>Not helpful</Button>;
  return <div role="group" aria-label="Why was this answer not helpful?" className="space-y-2 text-sm">
    <p className="font-medium">Why was this answer not helpful?</p>
    <div className="flex flex-wrap gap-2">
      {NOT_HELPFUL_REASONS.map(r => <Button key={r.code} type="button" size="sm" variant="outline" disabled={state === 'saving'}
        onClick={() => void send(r.code)}>{r.label}</Button>)}
      <Button type="button" size="sm" variant="ghost" disabled={state === 'saving'} onClick={() => { setState('idle'); setError(''); }}>Cancel</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}

