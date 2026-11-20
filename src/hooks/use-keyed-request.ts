// A request that keeps its key across an uncertain retry (the response was lost), so it is never recorded twice; the key
// changes only after a definite answer.
import * as React from 'react';

type Attempt = { busy: boolean; error: string; uncertain: boolean };
const IDLE: Attempt = { busy: false, error: '', uncertain: false };

/** Runs a request under one key; the key changes only after a definite answer, so a lost response is retried safely. */
export function useKeyedRequest() {
  const key = React.useRef(crypto.randomUUID());
  const [attempt, setAttempt] = React.useState<Attempt>(IDLE);
  const run = async <T,>(send: (key: string) => Promise<{ success: true; data: T } | { success: false; error: string; uncertain: boolean }>) => {
    setAttempt({ ...IDLE, busy: true });
    const result = await send(key.current);
    if (result.success) { key.current = crypto.randomUUID(); setAttempt(IDLE); return result.data; }
    if (!result.uncertain) key.current = crypto.randomUUID();
    setAttempt({ busy: false, error: result.error, uncertain: result.uncertain });
    return null;
  };
  const reset = () => { key.current = crypto.randomUUID(); setAttempt(IDLE); };
  return { attempt, run, reset };
}
