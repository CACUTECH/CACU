"use client";
// Doc 10: a shift left open at midnight business time is flagged on the home screen.
import * as React from 'react';
import Link from 'next/link';
import { listShiftsAction } from '@/app/pos/shift-actions';
import type { Shift } from '@/lib/shifts';

export function OpenShiftsNotice() {
  const [overdue, setOverdue] = React.useState<Shift[]>([]);
  React.useEffect(() => {
    let live = true;
    void listShiftsAction(undefined, 'open').then(result => {
      if (live && result.success && result.data) setOverdue(result.data.filter(s => s.overdue));
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (overdue.length === 0) return null;
  const names = overdue.map(s => s.mine ? 'yours' : s.opened_by_name).join(', ');
  return <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3">
    <p><span className="font-semibold">{overdue.length === 1 ? 'A shift was' : `${overdue.length} shifts were`} left open past midnight</span> ({names}).
      Count the till and close {overdue.length === 1 ? 'it' : 'them'}.</p>
    <Link className="font-semibold underline" href="/pos/shifts">Go to shifts</Link>
  </div>;
}
