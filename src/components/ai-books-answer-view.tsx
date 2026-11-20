"use client";
// One answer from the books (Doc 15): the AI label (AI-008), the answer as plain text, any figure CACU could not match
// to the books (AI-001), what the figures cannot see (AI-003) and links to the screens they came from (AI-002).
import Link from 'next/link';
import { AI_BOOKS_LABEL, type BooksAnswer } from '@/lib/ai-books';

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

