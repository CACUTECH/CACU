import Link from 'next/link';
import { HRService } from '@/services/hr-service';
import { AttendanceBoard } from '@/components/hr/attendance-board';
import { Button } from '@/components/ui/button';
import { isIsoDate, lagosToday } from '@/lib/hr';

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date } = await searchParams;
  const today = lagosToday();
  const day = date === undefined ? today : date;
  if (!isIsoDate(day) || day > today) {
    return <div role="alert">Choose a valid date that is not in the future. <Link href="/hr/attendance">Return to today</Link></div>;
  }
  let data;
  try { data = await new HRService().attendanceDay(day); }
  catch { return <div role="alert">Attendance could not be loaded. <Link href={`/hr/attendance?date=${day}`}>Retry</Link></div>; }
  return <div className="space-y-6">
    <h1 className="font-headline text-3xl font-bold">Attendance</h1>
    <form className="flex flex-wrap items-end gap-3" action="/hr/attendance">
      <label className="space-y-1 text-sm"><span className="block font-medium">Day</span>
        <input className="rounded-md border bg-background p-2" type="date" name="date" defaultValue={day} max={today} /></label>
      <Button type="submit" variant="outline">Show day</Button>
      {day !== today && <Button asChild variant="ghost"><Link href="/hr/attendance">Today</Link></Button>}
    </form>
    <p className="text-sm text-muted-foreground">{day === today ? 'Check-in is recorded at the current time.' : 'Past days are read-only, but open shifts can still be closed.'} Times are shown in Lagos time.</p>
    <AttendanceBoard staff={data.staff} records={data.records} open={data.open} isToday={day === today} />
  </div>;
}
