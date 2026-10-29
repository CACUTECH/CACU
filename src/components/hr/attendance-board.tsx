"use client";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { statusLabel } from '@/lib/hr';
import { useHRMutation } from './use-hr-mutation';
import { MutationFeedback } from './mutation-feedback';

type Staff = { id: string; full_name: string; job_title: string | null; employment_status: string | null };
type Shift = { id: string; employee_id: string; check_in: string | null; check_out?: string | null; note?: string | null; work_date: string | null };

const time = (value?: string | null) => value ? new Date(value).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—';

export function AttendanceBoard({ staff, records, open, isToday }: { staff: Staff[]; records: Shift[]; open: Shift[]; isToday: boolean }) {
  const { run, retry, busy, uncertain, error, message } = useHRMutation();
  const locked = busy || uncertain;
  return <div className="space-y-4">
    <MutationFeedback error={error} message={message} uncertain={uncertain} busy={busy} onRetry={() => void retry()} />
    <div className="overflow-x-auto rounded-md border"><Table>
      <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Shifts</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
      <TableBody>
        {staff.map(person => {
          const shift = open.find(s => s.employee_id === person.id);
          const day = records.filter(r => r.employee_id === person.id);
          const active = person.employment_status === 'active';
          return <TableRow key={person.id}>
            <TableCell><span className="font-medium">{person.full_name}</span><span className="block text-xs text-muted-foreground">{person.job_title || '—'}</span></TableCell>
            <TableCell>{day.length ? day.map(r => <span key={r.id} className="block">{time(r.check_in)} – {r.check_out ? time(r.check_out) : 'open'}{r.note ? ` (${r.note})` : ''}</span>) : '—'}</TableCell>
            <TableCell>{!active ? <Badge variant="outline">{statusLabel(person.employment_status)}</Badge>
              : shift ? <Badge>{shift.work_date && records.every(r => r.id !== shift.id) ? `Open since ${shift.work_date}` : 'Checked in'}</Badge>
              : <Badge variant="secondary">Not checked in</Badge>}</TableCell>
            <TableCell>{shift ? <Button size="sm" variant="outline" disabled={locked}
                onClick={() => void run('attendance.check_out', {}, { recordId: person.id, success: `${person.full_name} checked out.` })}>Check out</Button>
              : active && isToday ? <Button size="sm" disabled={locked}
                onClick={() => void run('attendance.check_in', {}, { recordId: person.id, success: `${person.full_name} checked in.` })}>Check in</Button> : null}</TableCell>
          </TableRow>;
        })}
        {!staff.length && <TableRow><TableCell colSpan={4} className="py-8 text-center">No current employees. Add employees before recording attendance.</TableCell></TableRow>}
      </TableBody>
    </Table></div>
  </div>;
}
