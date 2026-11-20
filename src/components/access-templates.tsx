"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { assignTemplateAction, deleteTemplateAction, saveDiscountCapAction, saveTemplateAction } from '@/app/settings/users/actions';
import { ACTIONS, MODULES, assignable, describeAccess, selectablePermission } from '@/lib/permission-templates';
import type { AccessTemplate, TemplateCatalogue } from '@/services/management-service';

/** What a template allows, one line per module. */
export function AccessSummary({ template }: { template?: AccessTemplate }) {
  if (!template) return null;
  const lines = describeAccess(template.permissions);
  return <ul className="space-y-1 text-xs text-muted-foreground" aria-label={`What ${template.name} can do`}>
    {lines.map(line => <li key={line.module}><span className="font-medium text-foreground">{line.label}:</span> {line.actions}</li>)}
    {template.role === 'admin' && <li>Works across all outlets.</li>}
  </ul>;
}

/** A template picker with a live summary of what the chosen template allows. */
export function TemplateSelect({ catalogue, value, current, disabled, onChange }: {
  catalogue: TemplateCatalogue; value: string; current?: string | null; disabled?: boolean; onChange: (id: string) => void;
}) {
  const options = assignable(catalogue.templates, current);
  return <div className="space-y-2">
    <label className="block space-y-1 text-sm"><span>What they can do</span>
      <select className="w-full rounded border bg-background p-2" required disabled={disabled} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Choose a template</option>
        {options.map(t => <option key={t.id} value={t.id}>{t.name}{t.builtin ? '' : ' (custom)'}</option>)}
      </select>
    </label>
    <AccessSummary template={catalogue.templates.find(t => t.id === value)} />
  </div>;
}

/** Gives an existing member another template. */
export function AccessDialog({ catalogue, member, onClose, onSaved }: {
  catalogue: TemplateCatalogue; member: { id: string; name?: string } | null; onClose: () => void; onSaved: (message: string) => void;
}) {
  const current = member ? catalogue.assigned[member.id] ?? null : null;
  const [choice, setChoice] = useState(current ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!member || !choice) return;
    setBusy(true); setError('');
    const result = await assignTemplateAction(member.id, choice);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    onSaved(`${member.name || 'Member'} now has ${catalogue.templates.find(t => t.id === choice)?.name ?? 'the new'} access.`);
  }
  return <Dialog open={!!member} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent><DialogHeader><DialogTitle>Access for {member?.name || 'member'}</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={e => void save(e)}>
        <TemplateSelect catalogue={catalogue} value={choice} current={current} disabled={busy} onChange={setChoice} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !choice || choice === current}>{busy ? 'Saving…' : 'Save access'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}

/** The templates tab: what every template allows, and custom profiles on Oga and Chairman. */
export function AccessTemplates({ catalogue, owner = false, onChanged }: { catalogue: TemplateCatalogue; owner?: boolean; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState<{ id: string | null; name: string; permissions: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const shown = catalogue.templates.filter(t => t.code !== 'owner' && (!t.legacy || t.members > 0));
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setError('');
    const result = await saveTemplateAction(editing.id, editing.name, [...editing.permissions]);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setEditing(null);
    onChanged(`Saved ${editing.name}. Everyone on it has the new access now.`);
  }
  async function remove(template: AccessTemplate) {
    if (!window.confirm(`Delete ${template.name}?`)) return;
    setBusy(true); setError('');
    const result = await deleteTemplateAction(template.id);
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    onChanged(`Deleted ${template.name}.`);
  }
  function toggle(code: string) {
    setEditing(e => e && { ...e, permissions: new Set(e.permissions.has(code) ? [...e.permissions].filter(p => p !== code) : [...e.permissions, code]) });
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">Each person gets one template. The owner always has full access.</p>
      {catalogue.custom_allowed
        ? <Button disabled={busy} onClick={() => setEditing({ id: null, name: '', permissions: new Set() })}>Create custom profile</Button>
        : <p className="text-sm text-muted-foreground">Custom profiles are on the Oga and Chairman plans.</p>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {shown.map(t => <div key={t.id} className="space-y-2 rounded border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t.name}</h3>
          <div className="flex gap-1">{!t.builtin && <Badge variant="outline">Custom</Badge>}<Badge variant="secondary">{t.members} {t.members === 1 ? 'person' : 'people'}</Badge></div>
        </div>
        <AccessSummary template={t} />
        {catalogue.discount_caps?.[t.id] != null && <DiscountLimit template={t} percent={catalogue.discount_caps[t.id] as number} owner={owner} onChanged={onChanged} />}
        {!t.builtin && <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ id: t.id, name: t.name, permissions: new Set(t.permissions) })}>Edit</Button>
          <Button size="sm" variant="outline" disabled={busy || t.members > 0} onClick={() => void remove(t)}>Delete</Button>
        </div>}
      </div>)}
    </div>
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !busy) setEditing(null); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing?.id ? 'Edit custom profile' : 'Create custom profile'}</DialogTitle></DialogHeader>
        {editing && <form className="space-y-4" onSubmit={e => void save(e)}>
          <label className="block space-y-1 text-sm"><span>Name</span>
            <Input required maxLength={60} disabled={busy} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="p-2 text-left">Area</th>{ACTIONS.map(([action, label]) => <th key={action} className="p-2">{label}</th>)}</tr></thead>
              <tbody>{MODULES.map(([module, label]) => <tr key={module} className="border-t">
                <td className="p-2">{label}</td>
                {ACTIONS.map(([action, actionLabel]) => {
                  const code = `${module}.${action}`;
                  return <td key={code} className="p-2 text-center">
                    {selectablePermission(code) && <input type="checkbox" aria-label={`${label}: ${actionLabel}`} disabled={busy}
                      checked={editing.permissions.has(code)} onChange={() => toggle(code)} />}
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Billing changes stay with the owner. You can only include access you have yourself.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !editing.name.trim() || editing.permissions.size === 0}>{busy ? 'Saving…' : 'Save profile'}</Button>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}

/** Doc 10: the largest line discount people on this template may give at the till. Only the owner changes it. */
function DiscountLimit({ template, percent, owner, onChanged }: { template: AccessTemplate; percent: number; owner: boolean; onChanged: (message: string) => void }) {
  const [value, setValue] = useState(String(percent)), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const valid = /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) <= 100;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true); setError('');
    const result = await saveDiscountCapAction(template.id, Number(value));
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setEditing(false);
    onChanged(`${template.name} can now give up to ${Number(value)}% off a line.`);
  }
  if (!editing) return <p className="text-xs">Discount limit: <span className="font-medium">{percent}%</span>
    {owner && <Button size="sm" variant="link" className="h-auto p-0 pl-2 text-xs" onClick={() => setEditing(true)}>Change</Button>}</p>;
  return <form className="flex flex-wrap items-center gap-2 text-xs" onSubmit={e => void save(e)}>
    <label className="flex items-center gap-1">Discount limit
      <Input aria-label={`Discount limit for ${template.name} (%)`} className="h-8 w-20" inputMode="decimal" value={value} disabled={busy} onChange={e => setValue(e.target.value)} />%</label>
    <Button size="sm" type="submit" disabled={busy || !valid}>Save</Button>
    <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setValue(String(percent)); }}>Cancel</Button>
    {error && <span role="alert" className="text-destructive">{error}</span>}
  </form>;
}
