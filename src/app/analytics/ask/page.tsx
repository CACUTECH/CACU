"use client";
// Analytics › Ask your books (Doc 15 AI on the books; E18 R3). Questions about this business, answered by AI from
// read-only lookups of the books. Every answer carries the AI label (AI-008), the period and links to the screens the
// figures came from (AI-002), what the figures cannot see (AI-003), and any figure CACU could not match to the books
// (AI-001). Off until CACU switches it on after gate G4 and the owner switches it on for the business (AI-012).
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getActiveBusinessIdAction } from '@/app/business-actions';
import { askAIBooksAction, getAIBooksStatusAction, setAIBooksAction } from '@/app/ai/books-actions';
import { AI_BOOKS_LABEL, type BooksAnswer } from '@/lib/ai-books';
import { BooksAnswerView } from '@/components/ai-books-answer-view';
import type { AIBooksRequest, AIBooksStatus } from '@/services/ai-books-service';

const EXAMPLES = ['How much profit did I make this month?', 'Who owes my business money?', 'What stock has not sold in 30 days?', 'Can I afford to restock next week?'];
export default function AskYourBooksPage() {
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<AIBooksStatus | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const [switching, setSwitching] = React.useState(false);
  const [question, setQuestion] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [hasAttempt, setHasAttempt] = React.useState(false);
  const [answers, setAnswers] = React.useState<{ question: string; answer: BooksAnswer }[]>([]);
  const attempt = React.useRef<AIBooksRequest | null>(null);
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    try {
      const id = await getActiveBusinessIdAction();
      setBusinessId(id);
      setStatus(await getAIBooksStatusAction(id));
      setLoadError('');
    } catch { setLoadError('Select a business you can access first.'); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const toggle = async (enabled: boolean) => {
    if (!businessId) return;
    setSwitching(true); setError('');
    try {
      const result = await setAIBooksAction(businessId, enabled);
      if (!result.ok) setError(result.message ?? 'The setting could not be saved. Try again.');
      if (!enabled) setAnswers([]);
      await load();
    } finally { setSwitching(false); }
  };

  const send = async () => {
    if (!status?.ready || !businessId || inFlight.current || (!attempt.current && !question.trim())) return;
    attempt.current ??= { businessId, requestKey: crypto.randomUUID(), question: question.trim() };
    const original = attempt.current;
    inFlight.current = true;
    setBusy(true); setHasAttempt(true); setError('');
    try {
      const result = await askAIBooksAction(original);
      if (result.ok) {
        const answer: BooksAnswer = { answer: result.answer, check: result.check, sources: result.sources, limitations: result.limitations, tools: result.tools };
        const allowance = result.allowance;
        setAnswers(previous => [...previous.slice(-4), { question: original.question, answer }]);
        attempt.current = null; setHasAttempt(false); setQuestion('');
        if (allowance !== undefined) setStatus(s => s && { ...s, allowance });
      } else {
        setError(result.message);
        // Refused before anything was recorded: this question can be dropped rather than retried.
        if (result.code === 'plan_limit' || result.code === 'invalid') { attempt.current = null; setHasAttempt(false); }
        if (result.code === 'access_denied' || result.code === 'unavailable') { setAnswers([]); await load(); }
      }
    } catch {
      setError('The answer was interrupted. Retry the same request before asking another question.');
    } finally { inFlight.current = false; setBusy(false); }
  };

  const ownerSwitch = status?.available && status.mayChange;
  return <div className="max-w-3xl space-y-6">
    <div>
      <h1 className="font-headline text-3xl font-bold">Ask your books</h1>
      <p className="text-muted-foreground">Questions about this business, answered by AI from your CACU books. It can look figures up; it cannot record or change anything.</p>
    </div>

    {loadError ? <p role="alert" className="text-destructive">{loadError}</p> : !status ? <p role="status">Checking…</p> : <>
      {!status.ready && <p role="status" className="rounded-lg border p-3 text-sm">{status.message}</p>}

      {ownerSwitch && <section aria-label="Switch for this business" className="space-y-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">{status.on ? 'Answers from your books are on for this business.' : 'Answers from your books are off for this business.'}</p>
        <p className="text-muted-foreground">When on, each question goes to OpenAI with your business type and the figures CACU looks up to answer it, such as totals, customer names and item names. CACU&apos;s lookups never include phone numbers, emails or bank details. CACU does not keep the question or the answer, and asks OpenAI not to store them. Each answer counts towards your plan&apos;s AI allowance. Only the owner can change this.</p>
        <Button variant={status.on ? 'outline' : 'default'} disabled={switching} onClick={() => void toggle(!status.on)}>
          {switching ? 'Saving…' : status.on ? 'Switch off' : 'Switch on for this business'}
        </Button>
      </section>}
      {status.available && !status.on && !status.mayChange && <p className="text-sm text-muted-foreground">Ask the business owner to switch this on.</p>}

      {status.ready && <section aria-label="Ask a question" className="space-y-4">
        <p className="text-xs text-muted-foreground">{AI_BOOKS_LABEL} You only see figures your role can see on the screens.</p>
        {status.allowance && <p role="status" className="text-sm font-medium">{status.allowance}</p>}
        <div role="log" aria-label="Answers" aria-live="polite" className="space-y-4">
          {answers.map((a, i) => <div key={i} className="space-y-2">
            <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap break-words">{a.question}</p>
            <BooksAnswerView answer={a.answer} />
          </div>)}
        </div>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void send(); }}>
          <label htmlFor="books-question" className="text-sm font-medium">Your question</label>
          <Textarea id="books-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000}
            disabled={busy || hasAttempt} placeholder="For example: How much profit did I make this month?" />
          {!question && !hasAttempt && <div className="flex flex-wrap gap-2">{EXAMPLES.map(x =>
            <Button key={x} type="button" size="sm" variant="secondary" onClick={() => setQuestion(x)}>{x}</Button>)}</div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || (!hasAttempt && !question.trim())}>
              {busy ? 'Looking at your books…' : hasAttempt ? 'Retry same request' : 'Ask'}
            </Button>
            {hasAttempt && <Button type="button" variant="outline" disabled={busy} onClick={() => { attempt.current = null; setHasAttempt(false); setQuestion(''); setError(''); }}>New question</Button>}
            {answers.length > 0 && <Button type="button" variant="ghost" disabled={busy} onClick={() => setAnswers([])}>Clear answers</Button>}
          </div>
        </form>
      </section>}
      {error && !status.ready && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </>}
  </div>;
}
