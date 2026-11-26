"use client";
// Analytics › Funding readiness (Doc 15 FR-180..185, FRA-001..012; E19 R3 parts 1 and 2). An indicative self-assessment
// from the business's own CACU books: whether it qualifies, and if so the score, its band, and every dimension with the
// measures, values and thresholds behind it (FRA-001). On the Oga and Chairman plans, what to do next for each weak
// dimension (FRA-002) and past assessments, monthly and on request (FRA-003). The notice (FRA-009) is always shown.
// Off until CACU switches it on after gate G5.
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { fundingAssessAction, fundingAssessmentAction, fundingOverviewAction } from './actions';
import { asHistory, FUNDING_NOTICE, scoreChange, showDate, showMeasure, type Assessment, type FundingOverview, type HistoryItem } from '@/lib/funding-readiness';

export default function FundingReadinessPage() {
  const [data, setData] = React.useState<FundingOverview | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [past, setPast] = React.useState<Assessment | null>(null);

  const load = React.useCallback(async () => {
    const r = await fundingOverviewAction();
    if (r.success) { setData(r.data); setError(''); } else { setData(null); setError(r.error); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const assess = async () => {
    setBusy(true); setError('');
    try {
      const r = await fundingAssessAction();
      if (r.success) {
        setPast(null);
        setData(d => d && { ...d, latest: r.data, assessed_today: true,
          history: d.history && (d.history.some(h => h.id === r.data.id) ? d.history : [asHistory(r.data), ...d.history]) });
      }
      else setError(r.error);
    } finally { setBusy(false); }
  };

  const open = async (id: string) => {
    setError('');
    if (id === data?.latest?.id) { setPast(null); return; }
    const r = await fundingAssessmentAction(id);
    if (r.success) setPast(r.data); else setError(r.error);
  };

  return <div className="max-w-4xl space-y-6">
    <div>
      <h1 className="font-headline text-3xl font-bold">Funding readiness</h1>
      <p className="text-muted-foreground">How your records and results look for a funding conversation, worked out from your CACU books.</p>
    </div>
    <p role="note" className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">{FUNDING_NOTICE}</p>

    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!data ? (!error && <p role="status">Loading…</p>) : !data.available ? <p role="status" className="rounded-lg border p-3 text-sm">{data.message}</p> : <>
      {data.eligibility && !data.eligibility.eligible && <section aria-label="Before you can be assessed" className="space-y-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">Before CACU can assess your business</p>
        <ul className="list-disc pl-5">{data.eligibility.missing.map(m => <li key={m.key + m.message}>{m.message}</li>)}</ul>
        {data.eligibility.earliest_date && <p>The earliest your books can qualify is {showDate(data.eligibility.earliest_date)}.</p>}
      </section>}

      {data.eligibility?.eligible && <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void assess()} disabled={busy || data.assessed_today}>
          {busy ? 'Working it out…' : data.latest ? 'Assess again' : 'Work out my score'}
        </Button>
        {data.assessed_today && <p className="text-sm text-muted-foreground">Assessed today. You can assess again tomorrow.</p>}
      </div>}

      {past && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm">
        <p>You are looking at a past assessment, from {showDate(past.assessed_on)}.</p>
        <Button variant="outline" size="sm" onClick={() => setPast(null)}>Back to the latest</Button>
      </div>}
      {(past ?? data.latest) && <AssessmentView assessment={(past ?? data.latest)!} />}

      {data.history && data.history.length > 0 && <HistoryView history={data.history} showing={(past ?? data.latest)?.id} onOpen={id => void open(id)} />}

      <section aria-label="What the score cannot see" className="text-sm">
        <p className="font-medium">What the score cannot see</p>
        <ul className="list-disc pl-5 text-muted-foreground">{data.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      </section>
    </>}
  </div>;
}

function AssessmentView({ assessment: a }: { assessment: Assessment }) {
  return <section aria-label="Your assessment" className="space-y-4">
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">Score, out of 100</p>
      <p className="text-5xl font-bold tabular-nums">{a.score}</p>
      <p className="text-lg font-medium">{a.band_label}</p>
      <p>{a.band_text}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {a.label}. Assessed {showDate(a.assessed_on)} from {showDate(a.period.start_date)} to {showDate(a.period.end_date)} ({a.period.months} full months),
        {' '}based on {a.based_on} of 7 dimensions. Scoring model {a.model_version}.
      </p>
    </div>
    {!a.recommendations_included && <p className="text-sm text-muted-foreground">What to do next for each area, and your past assessments, come with the Oga and Chairman plans.</p>}
    {a.dimensions.map(d => <div key={d.key} className="rounded-lg border p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{d.label}</p>
        <p className="tabular-nums">{d.score === null ? 'Not scored' : `${d.score} / 100`}
          <span className="text-muted-foreground">{d.share === null ? '' : `, ${d.share}% of the score`}</span></p>
      </div>
      <ul className="mt-2 space-y-1">{d.measures.map(m => <li key={m.key} className="flex flex-wrap justify-between gap-2">
        <span>{m.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {m.value === null ? (m.note ?? 'Not enough in the books to work this out.') :
            `${showMeasure(m.value, m.unit)} (100 at ${showMeasure(m.best, m.unit)}, 0 at ${showMeasure(m.worst, m.unit)})`}
          {m.score !== null && <span className="ml-2 font-medium text-foreground">{m.score} / 100</span>}
        </span>
      </li>)}</ul>
      {d.recommendations && d.recommendations.length > 0 && <div className="mt-3 rounded-md bg-muted/50 p-3">
        <p className="font-medium">What to do next</p>
        <ul className="list-disc pl-5">{d.recommendations.map(r => <li key={r}>{r}</li>)}</ul>
      </div>}
    </div>)}
    {a.information.stock_turnover && <p className="text-sm text-muted-foreground">{a.information.stock_turnover.label}: {a.information.stock_turnover.value}</p>}
  </section>;
}

function HistoryView({ history, showing, onOpen }: { history: HistoryItem[]; showing?: string; onOpen: (id: string) => void }) {
  return <section aria-label="Past assessments" className="space-y-2 text-sm">
    <p className="font-medium">Past assessments</p>
    <p className="text-muted-foreground">CACU works out a new assessment each month. Ones you asked for are here too.</p>
    <table className="w-full text-left">
      <thead><tr className="border-b text-muted-foreground"><th className="py-1 font-normal">Date</th><th className="font-normal">How</th>
        <th className="text-right font-normal">Score</th><th className="text-right font-normal">Change</th><th className="pl-3 font-normal">Band</th><th /></tr></thead>
      <tbody>{history.map((h, i) => {
        const change = scoreChange(history, i);
        return <tr key={h.id} className="border-b last:border-0">
          <td className="py-1">{showDate(h.assessed_on)}</td>
          <td>{h.kind === 'monthly' ? 'Monthly' : 'You asked'}</td>
          <td className="text-right tabular-nums">{h.score}</td>
          <td className="text-right tabular-nums">{change === null ? '' : change > 0 ? `+${change}` : `${change}`}</td>
          <td className="pl-3">{h.band_label}</td>
          <td className="text-right">{h.id === showing ? <span className="text-muted-foreground">Showing</span> :
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onOpen(h.id)}>View</Button>}</td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}
