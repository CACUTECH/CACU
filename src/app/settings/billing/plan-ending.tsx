"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { keepSummary, type CurrentPlan, type DowngradeChoices, type PlanCode } from '@/lib/billing';
import { cancelSubscriptionAction, getDowngradeChoicesAction, saveDowngradeChoicesAction } from './actions';

type Current = Extract<CurrentPlan, { subscribed: true }>;
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }) : 'the end of this period';

/** Cancelling (SUB-11, Owner only) and choosing who stays on a smaller plan (SUB-06, Owners and Admins). */
export function PlanEnding({ current, owner, manager, onChanged }: { current: Current; owner: boolean; manager: boolean; onChanged: () => Promise<void> }) {
  const running = ['active', 'trialing'].includes(current.status);
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const [choices, setChoices] = useState<DowngradeChoices | null>(null);
  const [users, setUsers] = useState<Set<string>>(new Set()), [outlets, setOutlets] = useState<Set<string>>(new Set());
  const ending = running && !current.cancel_at_period_end && (current.status === 'trialing' || Boolean(current.scheduled_plan));

  useEffect(() => {
    if (!manager || !ending) { setChoices(null); return; }
    let active = true;
    void getDowngradeChoicesAction().then(result => {
      if (!active || !result.success) return;
      setChoices(result.data);
      if (result.data.plan) {
        setUsers(new Set(result.data.members.filter(m => m.keep && m.role !== 'owner').map(m => m.user_id)));
        setOutlets(new Set(result.data.outlets.filter(o => o.keep).map(o => o.id)));
      }
    });
    return () => { active = false; };
  }, [manager, ending, current.scheduled_plan, current.status]);

  async function cancel(value: boolean) {
    setBusy(true); setError(''); setMessage('');
    const result = await cancelSubscriptionAction(value);
    setBusy(false); setConfirming(false);
    if (!result.success) { setError(result.error); return; }
    setMessage(value ? 'Subscription cancelled. Nothing changes until the period ends.' : 'Cancellation taken back. Your plan continues.');
    await onChanged();
  }

  async function save(plan: Extract<DowngradeChoices, { plan: PlanCode }>) {
    setBusy(true); setError(''); setMessage('');
    const result = await saveDowngradeChoicesAction([...users], [...outlets]);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setChoices(result.data);
    setMessage(`Saved. These people and outlets stay on the ${plan.plan_name} Plan.`);
  }

  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); update(next);
  };
  const plan = choices && choices.plan ? choices : null;
  const summary = plan ? keepSummary(plan, users, outlets) : null;

  if (!running || (!owner && !(plan && summary?.needed))) return null;
  return (
    <div className="space-y-4">
      {message && <p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">{message}</p>}
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      {plan && summary?.needed && (
        <Card>
          <CardHeader>
            <CardTitle>Who stays on the {plan.plan_name} Plan?</CardTitle>
            <CardDescription>
              From {day(current.current_period_end)} the {plan.plan_name} Plan has {plan.seats ?? 'unlimited'} seats and {plan.outlets_limit ?? 'unlimited'} outlets.
              Anyone or anything you do not tick becomes inactive then. Nothing is deleted, and you can reactivate them after an upgrade.
              {!plan.chosen && ' If you do not choose, the earliest added stay.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <fieldset className="space-y-2">
              <legend className="font-medium">People ({summary.seats} of {plan.seats ?? 'unlimited'} seats)</legend>
              {plan.members.map(member => (
                <label key={member.user_id} className="flex items-center gap-2">
                  <input type="checkbox" checked={member.role === 'owner' || users.has(member.user_id)} disabled={member.role === 'owner' || busy}
                    onChange={() => toggle(users, member.user_id, setUsers)} />
                  <span>{member.name || member.email || 'Team member'} <span className="text-muted-foreground">({member.role}{member.role === 'owner' ? ', always stays' : ''})</span></span>
                </label>))}
              {summary.seatsOver && <p role="alert" className="text-amber-700">That is more people than the plan has seats for.</p>}
            </fieldset>
            {plan.outlets.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="font-medium">Outlets ({summary.outlets} of {plan.outlets_limit ?? 'unlimited'})</legend>
                {plan.outlets.map(outlet => (
                  <label key={outlet.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={outlets.has(outlet.id)} disabled={busy} onChange={() => toggle(outlets, outlet.id, setOutlets)} />
                    <span>{outlet.name || 'Outlet'}</span>
                  </label>))}
                {summary.outletsOver && <p role="alert" className="text-amber-700">That is more outlets than the plan allows.</p>}
              </fieldset>)}
            <Button disabled={busy || summary.seatsOver || summary.outletsOver} onClick={() => void save(plan)}>{busy ? 'Saving…' : 'Save who stays'}</Button>
          </CardContent>
        </Card>)}

      {owner && (
        <div className="rounded-md border p-4 text-sm">
          {current.cancel_at_period_end ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Your subscription is cancelled and ends on {day(current.current_period_end)}.</span>
              <Button size="sm" disabled={busy} onClick={() => void cancel(false)}>Keep my subscription</Button>
            </div>
          ) : confirming ? (
            <div className="space-y-2">
              <p>You keep full access until {day(current.current_period_end)}. After that your workspace is read-only: you can still view and export everything, and nothing is deleted. Choose a plan any time to reopen it.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void cancel(true)}>{busy ? 'Cancelling…' : 'Yes, cancel'}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Keep my plan</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>Cancel subscription</Button>)}
        </div>)}
    </div>
  );
}
