"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusiness } from '@/components/business-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { readWorkspaceAction, mutateWorkspaceAction } from '@/app/settings/users/actions';
import type { ManagementMutation } from '@/services/management-service';
type Row = {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    status?: string;
    version: number;
    location_id?: string;
    all_locations?: boolean;
    is_active?: boolean;
    delivery_status?: string;
    created_at: string;
    event?: string;
    user_id?: string;
    members?: {
        id: string;
        name: string;
        active: boolean;
        email: string;
    }[];
};
type Location = {
    id: string;
    name: string;
    is_active: boolean;
    version: number;
};
export function UserManagement() {
    const { business } = useBusiness();
    const owner = business?.userRole === 'owner', manager = owner || business?.userRole === 'admin';
    const [tab, setTab] = useState('users'), [search, setSearch] = useState(''), [role, setRole] = useState(''), [status, setStatus] = useState(''), [location, setLocation] = useState(''), [page, setPage] = useState(0);
    const [rows, setRows] = useState<Row[]>([]), [total, setTotal] = useState(0), [lastActivity, setLastActivity] = useState<string | null>(null), [locations, setLocations] = useState<Location[]>([]), [revision, setRevision] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const [operation, setOperation] = useState<string | null>(null), [selected, setSelected] = useState<Row | null>(null), [fields, setFields] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(false);
    const request = useRef<ManagementMutation | null>(null), generation = useRef(0), key = useRef('');
    const load = useCallback(async () => {
        const token = ++generation.current;
        setLoading(true);
        setRows([]);
        setError('');
        try {
            const data = await readWorkspaceAction(tab, { search, role, status, location, offset: page * 20, limit: 20 });
            if (token === generation.current) {
                setRows(data.data);
                setTotal(data.total);
                setLastActivity(data.last_activity || null);
                setLocations(data.locations);
            }
        }
        catch (e) {
            if (token === generation.current)
                setError(e instanceof Error ? e.message : 'Workspace unavailable');
        }
        finally {
            if (token === generation.current)
                setLoading(false);
        }
    }, [tab, search, role, status, location, page]);
    useEffect(() => { if (!manager)
        return; const requests = generation; const timer = setTimeout(() => void load(), 250); return () => { clearTimeout(timer); requests.current++; }; }, [load, revision, manager, business?.id]);
    function open(op: string, row: Row | null = null) { if (request.current) {
        setOperation(request.current.operation);
        setAttempt(true);
        setError('An earlier save is unconfirmed. Retry the original request before starting another.');
        return;
    } setOperation(op); setSelected(row); setError(''); setAttempt(false); request.current = null; key.current = crypto.randomUUID(); setFields({ name: row?.name || '', email: row?.email || '', role: row?.role || 'viewer', location_id: row?.all_locations === false ? row.location_id || '' : '', is_active: String(row?.is_active ?? true) }); }
    async function mutate(input: ManagementMutation) { setBusy(true); setError(''); try {
        const result = await mutateWorkspaceAction(input);
        if (!result.success) {
            if (result.uncertain === false) {
                request.current = null;
                setAttempt(false);
            }
            throw new Error(result.error);
        }
        setOperation(null);
        request.current = null;
        setMessage(result.warning || 'Changes saved.');
        setRevision(v => v + 1);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed');
    }
    finally {
        setBusy(false);
    } }
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (!operation)
            return;
        let input = request.current;
        if (!input) {
            input = { request_key: key.current, operation, item_id: selected?.id ?? null, expected_version: selected?.version ?? null, details: { ...fields, all_locations: !fields.location_id, location_id: fields.location_id || null, is_active: fields.is_active === 'true' } };
            request.current = input;
            setAttempt(true);
        }
        await mutate(input);
    }
    function field(name: string, label: string, type = 'text') { return <label className="space-y-1 text-sm"><span>{label}</span><Input type={type} required disabled={busy || attempt} value={fields[name] || ''} onChange={e => setFields(f => ({ ...f, [name]: e.target.value }))}/></label>; }
    function locationSelect() { return <label className="space-y-1 text-sm"><span>Branch / Location</span><select className="w-full rounded border bg-background p-2" disabled={busy || attempt} value={fields.location_id || ''} onChange={e => setFields(f => ({ ...f, location_id: e.target.value }))}><option value="">All Locations</option>{locations.filter(l => l.is_active || l.id === fields.location_id).map(l => <option key={l.id} value={l.id}>{l.name}{!l.is_active ? ' (archived)' : ''}</option>)}</select></label>; }
    if (!manager)
        return <div><h1 className="text-3xl font-bold">User Management</h1><p role="alert">Owner or administrator access is required.</p></div>;
    return <div className="space-y-6"><div className="flex flex-wrap justify-between gap-3"><div><h1 className="font-headline text-3xl font-bold">User Management</h1><p className="text-muted-foreground">Manage your users, teams and business access.</p></div><Button onClick={() => open('invitation.create')}>Invite user</Button></div>
  <div role="tablist" aria-label="User management sections" className="flex flex-wrap gap-2">{['users', 'teams', 'sign-ins', 'usage'].map(t => <Button key={t} role="tab" aria-selected={t === tab} variant={t === tab ? 'default' : 'outline'} onClick={() => { setTab(t); setPage(0); setSearch(''); }}>{t === 'sign-ins' ? 'Sign-ins' : t[0].toUpperCase() + t.slice(1)}</Button>)}</div>
  <Card><CardContent className="space-y-4 pt-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{tab === 'users' ? `${total} matching accounts and invitations` : tab === 'teams' ? `${total} teams` : `${total} recorded events`}</h2>{tab === 'teams' && <Button onClick={() => open('team.save')}>Create team</Button>}</div>
   {tab === 'users' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Input aria-label="Search users" placeholder="Search name or email" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}/>
    <select aria-label="Role filter" className="rounded border bg-background p-2" value={role} onChange={e => { setRole(e.target.value); setPage(0); }}><option value="">All roles</option>{['owner', 'admin', 'editor', 'viewer'].map(r => <option key={r} value={r}>{r}</option>)}</select>
    <select aria-label="Status filter" className="rounded border bg-background p-2" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{['active', 'invited', 'deactivated'].map(s => <option key={s} value={s}>{s}</option>)}</select>
    <select aria-label="Location filter" className="rounded border bg-background p-2" value={location} onChange={e => { setLocation(e.target.value); setPage(0); }}><option value="">All Locations</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>}
   {tab === 'users' && <details><summary className="cursor-pointer text-sm">Branches and locations</summary><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => open('location.save')}>Create location</Button>{locations.map(l => <Button variant="outline" size="sm" key={l.id} onClick={() => open('location.save', { ...l, created_at: '' })}>{l.name}{!l.is_active ? ' (archived)' : ''}</Button>)}</div><p className="mt-3 text-xs text-muted-foreground">Location assignments organize users and teams. Existing financial and catalog records remain business-wide because they have no location field.</p></details>}
   {loading ? <p role="status">Loading...</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{(tab === 'users' ? ['Name / email', 'Role', 'Branch / Location', 'Status', 'Joined / invited', 'Actions'] : tab === 'teams' ? ['Team', 'Branch / Location', 'Members', 'Status', 'Actions'] : ['Member', 'Event', 'Time']).map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row => <tr className="border-t" key={row.id}>{tab === 'users' ? <><td className="p-3 font-medium">{row.name}<span className="block text-xs text-muted-foreground">{row.email || 'Email not recorded'}</span></td><td className="p-3 capitalize">{row.role}</td><td className="p-3">{row.all_locations ? 'All Locations' : locations.find(l => l.id === row.location_id)?.name || 'Location unavailable'}</td><td className="p-3 capitalize"><Badge variant={row.status === 'active' ? 'secondary' : 'outline'}>{row.status}</Badge>{row.status === 'invited' && <span className="block text-xs">Email: {row.delivery_status === 'requested' ? 'request accepted' : row.delivery_status || 'not requested'}</span>}</td><td className="p-3">{new Date(row.created_at).toLocaleDateString()}</td><td className="p-3"><div className="flex flex-wrap gap-2">{row.status === 'invited' ? <><Button variant="outline" size="sm" disabled={busy} onClick={() => void mutate({ request_key: crypto.randomUUID(), operation: 'invitation.resend', item_id: row.id, expected_version: row.version, details: {} })}>Renew invitation</Button><Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/join?invitation=${row.id}`).then(() => setMessage('Invitation link copied.')).catch(() => setError('Clipboard unavailable.'))}>Copy link</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm('Cancel this invitation?'))
        void mutate({ request_key: crypto.randomUUID(), operation: 'invitation.cancel', item_id: row.id, expected_version: row.version, details: {} }); }}>Cancel</Button></> : owner || row.role !== 'owner' ? <><Button variant="outline" size="sm" onClick={() => open('member.save', row)}>Edit</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm(`${row.status === 'active' ? 'Deactivate' : 'Reactivate'} ${row.name}?`))
        void mutate({ request_key: crypto.randomUUID(), operation: 'member.status', item_id: row.id, expected_version: row.version, details: { is_active: row.status !== 'active' } }); }}>{row.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button></> : <span>Owner protected</span>}</div></td></> : tab === 'teams' ? <><td className="p-3">{row.name}</td><td className="p-3">{locations.find(l => l.id === row.location_id)?.name || 'All Locations'}</td><td className="p-3">{row.members?.length || 0}<ul>{row.members?.map(m => <li key={m.id}>{m.name}{!m.active ? ' (deactivated)' : ''}</li>)}</ul></td><td className="p-3">{row.is_active ? 'Active' : 'Archived'}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => open('team.save', row)}>Edit</Button>{row.is_active && <><Button variant="outline" size="sm" onClick={() => open('team.add', row)}>Add member</Button><Button variant="outline" size="sm" onClick={() => open('team.remove', row)}>Remove member</Button></>}</div></td></> : <><td className="break-all p-3">{row.name || row.user_id || 'Not recorded'}</td><td className="p-3">{row.event}</td><td className="p-3">{new Date(row.created_at).toLocaleString()}</td></>}</tr>)}</tbody></table>{!rows.length && <p className="p-4">No recorded {tab === 'users' ? 'matching accounts' : tab === 'teams' ? 'teams' : 'events'}.</p>}</div>}
   {tab === 'sign-ins' && <p className="text-sm text-muted-foreground">Actual Supabase Auth events for current business members. Auth sessions are shared between businesses; branch, device and outcome are omitted when not reliably captured.</p>}{tab === 'usage' && <p className="text-sm text-muted-foreground">Last activity: {lastActivity ? new Date(lastActivity).toLocaleString() : 'No events recorded'}. Recorded management and application audit events. These are activity records, not billable usage or a complete count of every action.</p>}
   <div className="flex justify-end gap-2"><Button variant="outline" disabled={!page || loading} onClick={() => setPage(p => p - 1)}>Previous</Button><Button variant="outline" disabled={(page + 1) * 20 >= total || loading} onClick={() => setPage(p => p + 1)}>Next</Button></div>
  </CardContent></Card>{message && <p role="status">{message}</p>}{error && <p role="alert" className="text-destructive">{error}</p>}
  <Dialog open={!!operation} onOpenChange={v => { if (!v && !busy)
        setOperation(null); }}><DialogContent><DialogHeader><DialogTitle>{operation === 'invitation.create' ? 'Invite user' : operation === 'member.save' ? 'Edit user' : operation?.startsWith('team.') ? 'Manage team' : 'Branch / Location'}</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={e => void submit(e)}>
   {operation === 'team.add' || operation === 'team.remove' ? field('email', 'Existing business member email', 'email') : <>{field('name', 'Name')}{operation === 'invitation.create' && field('email', 'Email', 'email')}
    {['invitation.create', 'member.save'].includes(operation || '') && <label className="space-y-1 text-sm"><span>Role</span><select className="w-full rounded border bg-background p-2" disabled={busy || attempt} value={fields.role} onChange={e => setFields(f => ({ ...f, role: e.target.value }))}>{(owner && operation === 'member.save' ? ['owner', 'admin', 'editor', 'viewer'] : ['admin', 'editor', 'viewer']).map(r => <option key={r} value={r}>{r}</option>)}</select></label>}
    {operation !== 'location.save' && locationSelect()}{selected && (operation === 'location.save' || operation === 'team.save') && <label><input type="checkbox" checked={fields.is_active === 'true'} disabled={busy || attempt} onChange={e => setFields(f => ({ ...f, is_active: String(e.target.checked) }))}/> Active</label>}</>}
   {error && <p role="alert" className="text-destructive">{error}</p>}{attempt && <p className="text-sm">Retry sends the original request. Close and reopen to change invalid values.</p>}<Button type="submit" disabled={busy}>{busy ? 'Saving...' : attempt ? 'Retry original request' : 'Save'}</Button>
  </form></DialogContent></Dialog>
 </div>;
}
