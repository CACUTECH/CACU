"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusiness } from '@/components/business-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StockAdjustmentHistory } from '@/components/stock-adjustment-history';
import { StockApprovals } from '@/components/stock-approvals';
import { FileAttachments } from '@/components/file-attachments';
import { catalogOptionsAction, mutateCatalogAction, readCatalogAction } from '@/app/catalog/actions';
import type { ManagementMutation } from '@/services/management-service';
type Category = {
    id: string;
    name: string;
    item_type: string;
    is_active: boolean;
    version: number;
};
type Item = {
    id: string;
    name: string;
    item_type: string;
    sku: string;
    category_id: string | null;
    category: string;
    unit_price: string;
    cost_price: string | null;
    version: number;
    track_stock: boolean;
    stock_quantity: number;
    reorder_level: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    created_by: string | null;
    updated_by: string | null;
    [key: string]: unknown;
};
type Fields = Record<string, string | boolean>;
const today = () => new Date().toLocaleDateString('en-CA');
const initial = (type: string): Fields => ({ name: '', item_type: type, category_id: '', sku: '', unit_price: '0', cost_price: '0', unit_of_measure: 'piece', billing_unit: 'service', track_stock: type === 'PRODUCT', opening_quantity: '0', opening_date: today(), reorder_level: '0', description: '', barcode: '', supplier_id: '', notes: '', duration: '0', tax_code: 'none', is_active: true });
export function CatalogWorkspace({ inventory = false, nativeBooks = false }: {
    inventory?: boolean;
    /** Books are live: stock changes go through the approval rules, so Editors may request them. */
    nativeBooks?: boolean;
}) {
    const { business } = useBusiness();
    const manager = ['owner', 'admin'].includes(business?.userRole ?? '');
    const writer = manager || business?.userRole === 'editor';
    const canAdjust = manager || (nativeBooks && writer);
    const [type, setType] = useState('PRODUCT'), [search, setSearch] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState('active'), [low, setLow] = useState(false), [page, setPage] = useState(0);
    const [items, setItems] = useState<Item[]>([]), [total, setTotal] = useState(0), [categories, setCategories] = useState<Category[]>([]), [suppliers, setSuppliers] = useState<{
        id: string;
        name: string;
    }[]>([]);
    const [loading, setLoading] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [notice, setNotice] = useState('');
    const [mode, setMode] = useState<'edit' | 'view' | 'adjust' | 'category' | null>(null), [selected, setSelected] = useState<Item | null>(null), [fields, setFields] = useState<Fields>(initial(type)), [key, setKey] = useState(''), [attempt, setAttempt] = useState(false);
    const [categoryEdit, setCategoryEdit] = useState<Category | null>(null);
    const generation = useRef(0);
    const pending = useRef<ManagementMutation | null>(null);
    const load = useCallback(async () => {
        const token = ++generation.current;
        setLoading(true);
        setError('');
        setItems([]);
        try {
            const [result, options] = await Promise.all([readCatalogAction({ type, search, category, status, low_stock: low, limit: 20, offset: page * 20 }), catalogOptionsAction()]);
            if (token !== generation.current)
                return;
            setItems(result.data);
            setTotal(result.total);
            setCategories(options.categories);
            setSuppliers(options.suppliers);
        }
        catch (e) {
            if (token === generation.current)
                setError(e instanceof Error ? e.message : 'Catalog unavailable');
        }
        finally {
            if (token === generation.current)
                setLoading(false);
        }
    }, [type, search, category, status, low, page]);
    useEffect(() => { const requests = generation; const timer = setTimeout(() => void load(), 250); return () => { clearTimeout(timer); requests.current++; }; }, [load, revision, business?.id]);
    function open(next: typeof mode, item: Item | null = null, cat: Category | null = null) {
        if (pending.current) {
            setMode(pending.current.operation === 'stock.adjust' ? 'adjust' : pending.current.operation === 'category.save' ? 'category' : 'edit');
            setAttempt(true);
            setError('An earlier save is unconfirmed. Retry the original request before starting another.');
            return;
        }
        setSelected(item);
        setCategoryEdit(cat);
        setMode(next);
        setError('');
        setAttempt(false);
        pending.current = null;
        setKey(crypto.randomUUID());
        setFields(next === 'category' ? { name: cat?.name || '', is_active: cat?.is_active ?? true } : next === 'adjust' ? { delta: '0', reason: '', entry_date: today() } : item ? Object.fromEntries(Object.entries(initial(item.item_type)).map(([k, v]) => [k, typeof v === 'boolean' ? Boolean(item[k]) : String(item[k] ?? '')])) : initial(type));
    }
    async function mutate(input: ManagementMutation) { setBusy(true); setError(''); try {
        const result = await mutateCatalogAction(input);
        if (!result.success) {
            if (result.uncertain === false) {
                pending.current = null;
                setAttempt(false);
            }
            throw new Error(result.error);
        }
        const adjustment = (result.data as { adjustment?: { status?: string } } | null)?.adjustment;
        setNotice(adjustment?.status === 'pending' ? 'Stock change sent for approval. The quantity changes once an Owner or Admin approves it.' : '');
        setMode(null);
        pending.current = null;
        setRevision(n => n + 1);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed');
    }
    finally {
        setBusy(false);
    } }
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        let input = pending.current;
        if (!input) {
            if (mode === 'edit' && ['unit_price', 'cost_price'].some(k => !(k === 'cost_price' && selected && selected.cost_price == null && fields[k] === '') && String(fields[k]) !== String(selected?.[k]) && !/^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(String(fields[k])))) {
                setError('Enter a nonnegative price with at most two decimal places.');
                return;
            }
            const details: Record<string, unknown> = { ...fields };
            if (selected && selected.cost_price == null && fields.cost_price === '') delete details.cost_price;
            let operation = 'item.save', id = selected?.id, version = selected?.version;
            if (mode === 'category') {
                operation = 'category.save';
                id = categoryEdit?.id;
                version = categoryEdit?.version;
                details.item_type = type;
            }
            else if (mode === 'adjust') {
                operation = 'stock.adjust';
                details.delta = Number(details.delta);
            }
            else {
                details.category_id = details.category_id || null;
                details.supplier_id = details.supplier_id || null;
                details.duration = Number(details.duration);
                details.reorder_level = Number(details.reorder_level);
                if (selected && selected.duration == null && fields.duration === '') delete details.duration;
                if (selected && selected.reorder_level == null && fields.reorder_level === '') delete details.reorder_level;
                if (selected) {
                    delete details.opening_quantity;
                    delete details.opening_date;
                }
                else
                    details.opening_quantity = fields.item_type === 'PRODUCT' && details.track_stock ? Number(details.opening_quantity) : 0;
            }
            input = { request_key: key, operation, item_id: id ?? null, expected_version: version ?? null, details };
            pending.current = input;
            setAttempt(true);
        }
        await mutate(input);
    }
    function field(name: string, label: string, inputType = 'text', required = false) { return <label className="space-y-1 text-sm" key={name}><span>{label}</span><Input type={inputType} value={String(fields[name] ?? '')} required={required} min={inputType === 'number' ? '0' : undefined} step={inputType === 'number' ? '1' : undefined} disabled={busy || attempt} onChange={e => setFields(f => ({ ...f, [name]: e.target.value }))}/></label>; }
    function select(name: string, label: string, options: {
        value: string;
        label: string;
    }[]) { return <label className="space-y-1 text-sm" key={name}><span>{label}</span><select className="w-full rounded-md border bg-background p-2" value={String(fields[name] ?? '')} disabled={busy || attempt || (name === 'unit_of_measure' && Boolean(selected?.structure_locked))} onChange={e => setFields(f => ({ ...f, [name]: e.target.value }))}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>; }
    const formType = String(fields.item_type || type);
    const activeCategories = categories.filter(c => c.item_type === formType && (c.is_active || c.id === fields.category_id));
    return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-headline text-3xl font-bold">{inventory ? 'Inventory' : 'Products and services'}</h1><p className="text-muted-foreground">Manage your catalog, categories and stock with a recorded history.</p></div>{writer && <Button onClick={() => open('edit')}>Add {type === 'PRODUCT' ? 'product' : 'service'}</Button>}</div>
  <div role="tablist" aria-label="Catalog type" className="flex gap-2">{['PRODUCT', 'SERVICE'].map(t => <Button key={t} role="tab" aria-selected={type === t} variant={type === t ? 'default' : 'outline'} onClick={() => { setType(t); setCategory(''); setLow(false); setPage(0); }}>{t === 'PRODUCT' ? 'Products' : 'Services'}</Button>)}</div>
  <Card><CardContent className="space-y-4 pt-6"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Input aria-label="Search catalog" placeholder="Search name, code or category" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}/>
   <select aria-label="Category filter" className="rounded border bg-background p-2" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="">All categories</option><option value="none">Uncategorized</option>{categories.filter(c => c.item_type === type).map(c => <option key={c.id} value={c.id}>{c.name}{!c.is_active ? ' (archived)' : ''}</option>)}</select>
   <select aria-label="Status filter" className="rounded border bg-background p-2" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="active">Active</option><option value="archived">Archived</option><option value="">All statuses</option></select>
   {type === 'PRODUCT' && <label className="flex items-center gap-2"><input type="checkbox" checked={low} onChange={e => { setLow(e.target.checked); setPage(0); }}/>Low stock only</label>}</div>
   {manager && <details><summary className="cursor-pointer text-sm">Manage categories</summary><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => open('category')}>New category</Button>{categories.filter(c => c.item_type === type).map(c => <Button key={c.id} size="sm" variant="outline" onClick={() => open('category', null, c)}>{c.name}{!c.is_active ? ' (archived)' : ''}</Button>)}</div></details>}
   {loading ? <p role="status">Loading catalog...</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Name / code', 'Category', 'Price (NGN)', 'Stock', 'Status', 'Actions'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-t"><td className="p-3 font-medium">{item.name}<span className="block text-xs text-muted-foreground">{item.sku || 'No code'}</span></td><td className="p-3">{item.category}</td><td className="p-3">{item.unit_price}</td><td className="p-3">{item.item_type === 'SERVICE' ? 'Service' : !item.track_stock ? 'Not tracked' : `${item.stock_quantity ?? 0} ${item.unit_of_measure}`} {item.item_type === 'PRODUCT' && item.track_stock && item.is_active && (item.stock_quantity ?? 0) <= item.reorder_level && <span className="text-destructive">Low stock</span>}</td><td className="p-3">{item.is_active ? 'Active' : 'Archived'}</td><td className="p-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => open('view', item)}>View</Button>{manager && <Button size="sm" variant="outline" onClick={() => open('edit', item)}>Edit</Button>}</div></td></tr>)}</tbody></table>{!items.length && <p className="p-4">No matching items.</p>}</div>}
   <div className="flex items-center justify-between"><p className="text-sm">{total} items</p><div className="flex gap-2"><Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>Previous</Button><Button variant="outline" disabled={(page + 1) * 20 >= total || loading} onClick={() => setPage(p => p + 1)}>Next</Button></div></div>
  </CardContent></Card>{error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p role="status">{notice}</p>}
  {inventory && nativeBooks && <StockApprovals revision={revision} onDecided={() => setRevision(n => n + 1)}/>}
  <Dialog open={mode !== null} onOpenChange={value => { if (!value && !busy)
        setMode(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{mode === 'view' ? selected?.name : mode === 'adjust' ? 'Adjust stock' : mode === 'category' ? 'Category' : selected ? 'Edit item' : 'Add item'}</DialogTitle></DialogHeader>
   {mode === 'view' && selected ? <div className="space-y-4"><dl className="grid grid-cols-2 gap-3">{['name', 'sku', 'category', 'description', 'unit_price', 'cost_price', 'unit_of_measure', 'billing_unit', 'barcode', 'notes', 'created_at', 'updated_at', 'created_by', 'updated_by'].map(k => <div key={k}><dt className="text-xs capitalize text-muted-foreground">{k.replaceAll('_', ' ')}</dt><dd className="break-words text-sm">{String(selected[k] ?? 'Not recorded')}</dd></div>)}</dl>{canAdjust && !manager && selected.item_type === 'PRODUCT' && selected.track_stock && selected.is_active && <Button variant="outline" onClick={() => open('adjust', selected)}>Request stock change</Button>}{manager && <div className="flex flex-wrap gap-2"><Button onClick={() => open('edit', selected)}>Edit</Button>{selected.item_type === 'PRODUCT' && selected.track_stock && <Button variant="outline" onClick={() => open('adjust', selected)}>Adjust stock</Button>}<Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(`${selected.is_active ? 'Archive' : 'Reactivate'} ${selected.name}? Historical documents will be preserved.`))
            void mutate({ request_key: crypto.randomUUID(), operation: 'item.save', item_id: selected.id, expected_version: selected.version, details: { is_active: !selected.is_active } }); }}>{selected.is_active ? 'Archive' : 'Reactivate'}</Button></div>}{selected.item_type === 'PRODUCT' && <StockAdjustmentHistory key={`${business?.id}/${selected.id}`} itemId={selected.id}/>}<FileAttachments purpose="catalog_image" resourceId={selected.id}/></div> : <form onSubmit={event => void submit(event)} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">{mode === 'category' ? <>{field('name', 'Category name', 'text', true)}<label><input type="checkbox" checked={Boolean(fields.is_active)} disabled={busy || attempt} onChange={e => setFields(f => ({ ...f, is_active: e.target.checked }))}/> Active category</label></> : mode === 'adjust' ? <>{field('delta', 'Quantity change (+ or -)', 'text', true)}{field('entry_date', 'Effective date', 'date', true)}{field('reason', 'Reason', 'text', true)}<p className="text-sm">Current stock: {selected?.stock_quantity ?? 0}. This creates an audited stock movement and a native accounting entry when applicable.</p></> : <>
     <label className="space-y-1 text-sm"><span>Item type</span><select aria-label="Item type" className="w-full rounded-md border bg-background p-2" value={formType} disabled={busy || attempt || Boolean(selected?.structure_locked)} onChange={e => { const next = e.target.value; setFields(f => ({ ...f, item_type: next, category_id: '', track_stock: next === 'PRODUCT', opening_quantity: '0', reorder_level: '0' })); }}><option value="PRODUCT">Product</option><option value="SERVICE">Service</option></select>{Boolean(selected?.structure_locked) && <span className="block text-xs text-muted-foreground">Type, stock unit and tracking are locked once stock, adjustments or document references exist.</span>}</label>{field('name', 'Name', 'text', true)}{field('sku', 'Code (generated when blank)')}{select('category_id', 'Category', [{ value: '', label: 'Uncategorized' }, ...activeCategories.map(c => ({ value: c.id, label: c.name }))])}
     {manager && <div className="space-y-1"><label className="block text-sm" htmlFor="inline-category">Create category</label><Input id="inline-category" placeholder="New category name" disabled={busy || attempt} onKeyDown={e => { if (e.key === 'Enter') {
                e.preventDefault();
                const name = e.currentTarget.value;
                setBusy(true);
                void mutateCatalogAction({ request_key: crypto.randomUUID(), operation: 'category.save', details: { name, item_type: formType } }).then(result => { if (result.success) {
                    const c = result.data as Category;
                    setCategories(list => [...list, c]);
                    setFields(f => ({ ...f, category_id: c.id }));
                }
                else
                    setError(result.error); }).finally(() => setBusy(false));
            } }}/><p className="text-xs text-muted-foreground">Press Enter to create and select.</p></div>}
     {field('unit_price', formType === 'PRODUCT' ? 'Selling price (NGN)' : 'Rate (NGN)', 'text', true)}{formType === 'PRODUCT' && field('cost_price', 'Cost per unit (NGN)')}
     {formType === 'PRODUCT' ? <><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(fields.track_stock)} disabled={busy || attempt || Boolean(selected?.structure_locked)} onChange={e => setFields(f => ({ ...f, track_stock: e.target.checked }))}/>Track stock</label>{!selected && fields.track_stock && <>{field('opening_quantity', 'Opening quantity', 'number')}{field('opening_date', 'Opening date', 'date')}</>}{fields.track_stock && field('reorder_level', 'Low stock threshold', 'number')}</> : select('billing_unit', 'Billing unit', ['service', 'hour', 'day', 'project'].map(value => ({ value, label: value })))}</>}
    </div>{mode === 'edit' && <details><summary className="cursor-pointer">Additional details</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">{formType === 'SERVICE' && field('cost_price', 'Internal cost (NGN)')}{field('description', 'Description')}{formType === 'PRODUCT' ? <>{select('unit_of_measure', 'Stock unit', ['piece', 'pack', 'carton', 'kg', 'litre'].map(value => ({ value, label: value })))}{field('barcode', 'Barcode')}{select('supplier_id', 'Supplier', [{ value: '', label: 'None' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))])}</> : field('duration', 'Estimated minutes', 'number')}{field('notes', 'Notes')}<label className="text-sm">Tax<select className="mt-1 w-full rounded border bg-background p-2" disabled><option>No tax</option></select></label><label><input type="checkbox" checked={Boolean(fields.is_active)} disabled={busy || attempt} onChange={e => setFields(f => ({ ...f, is_active: e.target.checked }))}/> Active</label></div><p className="mt-3 text-xs text-muted-foreground">Stock uses whole units, including kg and litres. Tax configuration is pending review. Add a private image after saving the item.</p></details>}
    {error && <p role="alert" className="text-destructive">{error}</p>}{attempt && <p className="text-sm">Retry sends the original request safely. Close and reopen to correct validation errors.</p>}<Button type="submit" disabled={busy}>{busy ? 'Saving...' : attempt ? 'Retry original request' : 'Save'}</Button>
   </form>}
  </DialogContent></Dialog>
 </div>;
}
