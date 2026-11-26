// The lender pack (Doc 15 FRA-006): the owner's preview and the lender's link show exactly the same thing. The
// management statements for the period, the assessment with its explanation, a data-completeness note and the
// business profile; nothing else. The notice (FRA-009) and the "not reviewed" label (BR-061) are always shown.
import * as React from 'react';
import { naira, showDate, showMeasure, type FundingPack } from '@/lib/funding-readiness';

const KIND: Record<string, string> = { PRODUCT: 'Sells goods', SERVICE: 'Sells services', HYBRID: 'Sells goods and services' };

function Statement({ title, sections, totals }: { title: string; sections: FundingPack['statements']['income_statement']['sections']; totals: [string, string][] }) {
  return <section aria-label={title} className="space-y-2">
    <h3 className="font-medium">{title}</h3>
    <table className="w-full text-sm"><tbody>
      {sections.map(s => <React.Fragment key={s.key}>
        <tr><th colSpan={2} className="pt-2 text-left font-medium">{s.title}</th></tr>
        {s.lines.map((l, i) => <tr key={`${s.key}-${l.code ?? i}-${l.name}`}><td className="pl-3">{l.code ? `${l.code} ` : ''}{l.name}</td>
          <td className="text-right tabular-nums">{naira(l.amounts[0])}</td></tr>)}
        <tr className="border-t"><td className="pl-3 text-muted-foreground">Total {s.title.toLowerCase()}</td><td className="text-right tabular-nums">{naira(s.total[0])}</td></tr>
      </React.Fragment>)}
      {totals.map(([label, value]) => <tr key={label} className="border-t font-medium"><td>{label}</td><td className="text-right tabular-nums">{naira(value)}</td></tr>)}
    </tbody></table>
  </section>;
}

export function FundingPackView({ pack }: { pack: FundingPack }) {
  const s = pack.statements;
  const a = pack.assessment;
  const c = pack.completeness;
  return <article aria-label="Lender pack" className="space-y-6 text-sm">
    <p role="note" className="rounded-lg border border-amber-500 bg-amber-50 p-3 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">{pack.notice}</p>

    <section aria-label="Business profile" className="space-y-1">
      <h2 className="text-lg font-semibold">{pack.business.name ?? 'The business'}</h2>
      {pack.business.business_type && <p>{KIND[pack.business.business_type] ?? pack.business.business_type}</p>}
      {pack.business.address && <p>{pack.business.address}</p>}
      {pack.business.books_started && <p>Books kept in CACU since {showDate(pack.business.books_started)}.</p>}
      <p className="text-muted-foreground">{pack.label}. Covers {showDate(pack.period.start_date)} to {showDate(pack.period.end_date)} ({pack.period.months} full months).
        {' '}Prepared {showDate(pack.prepared_on)}.</p>
    </section>

    <section aria-label="Management statements" className="space-y-4">
      <h2 className="text-lg font-semibold">{s.tier}</h2>
      <p className="text-muted-foreground">{s.basis} basis, in {s.currency === 'NGN' ? 'naira' : s.currency}. Prepared from the business&apos;s own records; no accountant has reviewed them.</p>
      {s.checks.length > 0 && <ul className="list-disc pl-5 text-destructive">{s.checks.map(m => <li key={m}>{m}</li>)}</ul>}
      <Statement title="Profit or loss" sections={s.income_statement.sections}
        totals={[['Gross profit', s.income_statement.gross_profit[0]], ['Net profit', s.income_statement.net_profit[0]]]} />
      <Statement title={`Financial position at ${showDate(pack.period.end_date)}`} sections={s.financial_position.sections}
        totals={[['Total assets', s.financial_position.total_assets[0]], ['Total liabilities', s.financial_position.total_liabilities[0]],
          ['Total equity', s.financial_position.total_equity[0]]]} />
      <section aria-label="Changes in equity" className="space-y-2">
        <h3 className="font-medium">Changes in equity</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Account</th><th className="text-right font-normal">Opening</th>
            <th className="text-right font-normal">Movement</th><th className="text-right font-normal">Closing</th></tr></thead>
          <tbody>{s.changes_in_equity.lines.map((l, i) => <tr key={`${l.code ?? i}-${l.name}`}><td>{l.code ? `${l.code} ` : ''}{l.name}</td>
            <td className="text-right tabular-nums">{naira(l.opening)}</td><td className="text-right tabular-nums">{naira(l.movement)}</td>
            <td className="text-right tabular-nums">{naira(l.closing)}</td></tr>)}
          <tr className="border-t font-medium"><td>Total equity</td><td className="text-right tabular-nums">{naira(s.changes_in_equity.total.opening)}</td>
            <td className="text-right tabular-nums">{naira(s.changes_in_equity.total.movement)}</td><td className="text-right tabular-nums">{naira(s.changes_in_equity.total.closing)}</td></tr>
          </tbody>
        </table>
      </section>
      <section aria-label="Cash flow" className="space-y-2">
        <h3 className="font-medium">Cash flow</h3>
        {s.cash_flow.note ? <p className="text-muted-foreground">{s.cash_flow.note}</p> :
          <table className="w-full text-sm"><tbody>
            <tr><td>Cash and bank at the start</td><td className="text-right tabular-nums">{naira(s.cash_flow.opening_cash)}</td></tr>
            {s.cash_flow.sections.map(sec => <React.Fragment key={sec.key}>
              {sec.lines.map(l => <tr key={`${sec.key}-${l.label}`}><td className="pl-3">{l.label}</td><td className="text-right tabular-nums">{naira(l.amount)}</td></tr>)}
              <tr className="border-t"><td className="pl-3 text-muted-foreground">Total {sec.key} activities</td><td className="text-right tabular-nums">{naira(sec.total)}</td></tr>
            </React.Fragment>)}
            <tr className="border-t font-medium"><td>Cash and bank at the end</td><td className="text-right tabular-nums">{naira(s.cash_flow.closing_cash)}</td></tr>
          </tbody></table>}
      </section>
    </section>

    <section aria-label="Funding readiness assessment" className="space-y-3">
      <h2 className="text-lg font-semibold">Funding readiness assessment</h2>
      <p><span className="text-3xl font-bold tabular-nums">{a.score}</span> out of 100: <span className="font-medium">{a.band_label}</span>. {a.band_text}</p>
      <p className="text-muted-foreground">Assessed {showDate(a.assessed_on)} with scoring model {a.model_version}, based on {a.based_on} of 7 areas.</p>
      {a.dimensions.map(d => <div key={d.key} className="rounded-lg border p-3">
        <p className="flex flex-wrap justify-between gap-2 font-medium"><span>{d.label}</span>
          <span className="tabular-nums">{d.score === null ? 'Not scored' : `${d.score} / 100`}</span></p>
        <ul className="mt-1 space-y-1">{d.measures.map(m => <li key={m.key} className="flex flex-wrap justify-between gap-2">
          <span>{m.label}</span>
          <span className="tabular-nums text-muted-foreground">{m.value === null ? (m.note ?? 'Not enough in the books to work this out.') :
            `${showMeasure(m.value, m.unit)} (100 at ${showMeasure(m.best, m.unit)}, 0 at ${showMeasure(m.worst, m.unit)})`}</span>
        </li>)}</ul>
      </div>)}
      {a.information.stock_turnover && <p className="text-muted-foreground">{a.information.stock_turnover.label}: {a.information.stock_turnover.value}</p>}
    </section>

    <section aria-label="How complete the records are" className="space-y-1">
      <h2 className="text-lg font-semibold">How complete the records are</h2>
      <ul className="list-disc pl-5">
        <li>{c.months} full months of books, {c.dimensions_used} of {c.dimensions_total} areas could be worked out.</li>
        {c.trading_days_recorded !== null && <li>Something was recorded on {showMeasure(c.trading_days_recorded, 'percent')} of trading days (Monday to Saturday).</li>}
        <li>{c.open_exceptions_when_prepared === 0 ? 'Nothing was waiting to be sorted out when the pack was prepared.' :
          `${c.open_exceptions_when_prepared} item${c.open_exceptions_when_prepared === 1 ? ' was' : 's were'} waiting to be sorted out when the pack was prepared.`}</li>
        {c.not_worked_out.length > 0 && <li>Not enough in the books to work out: {c.not_worked_out.join('; ')}.</li>}
        {c.notes.map(n => <li key={n}>{n}</li>)}
      </ul>
    </section>
  </article>;
}
