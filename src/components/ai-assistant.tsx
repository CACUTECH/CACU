"use client";

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AI_UNAVAILABLE_MESSAGE } from '@/lib/ai-availability';
import { askAIQuestionAction, getAIChatStatusAction } from '@/app/ai/actions';
import type { AIChatRequest } from '@/services/ai-chat-service';

export function AIAssistant({ businessId }: { businessId?: string }) {
  return <AssistantPanel key={businessId ?? 'no-business'} businessId={businessId} />;
}
function AssistantPanel({ businessId }: { businessId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [hasAttempt, setHasAttempt] = useState(false);
  const [messages, setMessages] = useState<{ question: string; answer: string }[]>([]);
  const attempt = useRef<AIChatRequest | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (isOpen && businessId) {
      setChecking(true); setReady(false);
      void getAIChatStatusAction(businessId).then(result => {
        if (active) { setReady(result.ready); setStatus(result.message); }
      }).catch(() => { if (active) setStatus('AI setup could not be checked. Close and reopen to retry.'); })
        .finally(() => { if (active) setChecking(false); });
    }
    return () => { active = false; };
  }, [isOpen, businessId]);
  const send = async () => {
    if (!ready || inFlight.current || !businessId || (!attempt.current && !question.trim())) return;
    attempt.current ??= { businessId, requestKey: crypto.randomUUID(), question: question.trim() };
    const original = attempt.current;
    inFlight.current = true;
    setBusy(true); setHasAttempt(true); setError('');
    try {
      const result = await askAIQuestionAction(original);
      if (!alive.current) return;
      if (result.ok) {
        setMessages(previous => [...previous.slice(-4), { question: original.question, answer: result.answer }]);
        attempt.current = null; setHasAttempt(false); setQuestion('');
      } else {
        setError(result.message);
        if (result.code === 'access_denied' || result.code === 'unavailable') {
          setReady(false); setStatus(result.message); setMessages([]);
        }
      }
    } catch {
      if (alive.current) setError('The response was interrupted. Retry the same request before starting another question.');
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return <>
    <Button aria-label="AI assistant availability" onClick={() => setIsOpen(true)}
      className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50" size="icon">
      <Sparkles className="h-6 w-6" aria-hidden="true" />
    </Button>
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent className="w-full sm:max-w-md flex flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>CACU AI Assistant</SheetTitle>
          <SheetDescription>{ready ? 'General business guidance from OpenAI. Each question is answered independently.' : AI_UNAVAILABLE_MESSAGE}</SheetDescription>
        </SheetHeader>
        {!ready && <p role="status" className="mt-4 text-sm text-muted-foreground">{checking ? 'Checking availability…' : status || 'Select an active business to check AI availability.'}</p>}
        <p className="mt-4 text-sm text-muted-foreground">No financial or employee records or page contents are read. AI answers may be inaccurate; review them before acting.</p>
        {ready && <>
          <p className="text-sm text-muted-foreground">Your question is sent to OpenAI. Do not include personal or confidential records.</p>
          <div role="log" aria-label="AI conversation" aria-live="polite" className="flex-1 space-y-4 min-h-12">
            {messages.map((message, index) => <div key={index} className="space-y-2 text-sm break-words">
              <p className="rounded-lg bg-muted p-3 whitespace-pre-wrap">{message.question}</p>
              <p className="rounded-lg border p-3 whitespace-pre-wrap">{message.answer}</p>
            </div>)}
          </div>
          <form className="space-y-3 mt-4" onSubmit={event => { event.preventDefault(); void send(); }}>
            <label htmlFor="ai-question" className="text-sm font-medium">Your question</label>
            <Textarea id="ai-question" value={question} onChange={event => setQuestion(event.target.value)}
              maxLength={2000} disabled={busy || hasAttempt} placeholder="Ask for general business guidance" />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || (!hasAttempt && !question.trim())}>
              {busy ? 'Waiting for answer…' : hasAttempt ? 'Retry same request' : 'Ask OpenAI'}
            </Button>
            {hasAttempt && <Button type="button" variant="outline" disabled={busy} onClick={() => {
              attempt.current = null; setHasAttempt(false); setQuestion(''); setError('');
            }}>New question</Button>}
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setMessages([])}>Clear chat</Button>
          </form>
        </>}
        <Button className="mt-4" variant="outline" onClick={() => setIsOpen(false)}>Close</Button>
      </SheetContent>
    </Sheet>
  </>;
}
