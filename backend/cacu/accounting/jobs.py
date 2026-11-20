"""Jobs (Doc 10 services, bookings and jobs rules), bookings part 4.

A job has service and material lines from the catalogue and labour time per staff member; people edit those through the
Data API while the job is open or in progress (database rules enforce it). Completing a job happens here: its tracked
materials leave stock at cost (debit cost of sales, credit inventory), and that cost is recorded on the job. A completed
job is billed once, at the till (POST /sales with job_id) or by invoice, at catalogue prices, and its materials are not
issued again. Job profit (Chairman, module.job_costing) is revenue less materials at cost less labour at each staff
member's cost rate, which the owner sets."""
from decimal import Decimal
import json
from uuid import UUID, uuid5
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cacu.accounting.posting import PostingCommand, post_command, raw
from cacu.accounting.session import allowed
from cacu.accounting.workflows import business_today, durable, purpose, role

ZERO = Decimal('0')
AMOUNT = r'^[0-9]{1,13}(\.[0-9]{1,2})?$'


class JobComplete(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID


class JobInvoice(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    customer_id: UUID | None = None


class CostRate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    staff_id: UUID
    hourly: str = Field(pattern=AMOUNT)


class CostRates(BaseModel):
    model_config = ConfigDict(extra='forbid')
    rates: list[CostRate] = Field(max_length=200)


def _money(value):
    return format(value, '.2f') if value is not None else None


def costing_allowed(session):
    return bool(raw(session, 'SELECT accounting.job_costing_allowed(%s)', (str(session.business_id),)).scalar())


def _job(session, job_id, lock=False):
    row = raw(session, f"SELECT * FROM public.jobs WHERE business_id=%s AND id=%s{' FOR UPDATE' if lock else ''}",
              (str(session.business_id), str(job_id))).first()
    if not row: raise HTTPException(404, 'Job not found')
    return row


def _lines(session, job_id):
    return raw(session, """SELECT l.catalog_item_id,l.quantity,c.name,c.item_type,c.unit_price,c.cost_price,
        (c.item_type='PRODUCT' AND coalesce((to_jsonb(c)->>'track_stock')::boolean,true)) AS tracked
      FROM public.job_lines l JOIN public.catalog_items c ON c.business_id=l.business_id AND c.id=l.catalog_item_id
      WHERE l.business_id=%s AND l.job_id=%s ORDER BY c.item_type DESC,c.name""", (str(session.business_id), str(job_id))).all()


def _issue(session, actor, key, lines, day):
    """Issues tracked materials at cost, as a sale would (PR-06), against the job's request key; returns the cost."""
    from cacu.accounting.inventory import allowance_post, consume
    from cacu.accounting import outlets
    tenant = str(session.business_id); cost = ZERO
    outlets.use(session, outlets.selling(session, actor))
    for line in sorted((l for l in lines if l.tracked), key=lambda l: str(l.catalog_item_id)):
        row = raw(session, "SELECT stock_quantity,cost_price FROM public.catalog_items WHERE business_id=%s AND id=%s AND is_active FOR UPDATE",
                  (tenant, str(line.catalog_item_id))).first()
        if not row or row.cost_price is None or row.cost_price < 0: raise HTTPException(409, f'{line.name} has no cost to issue it at')
        if (row.stock_quantity or 0) < line.quantity:
            raise HTTPException(409, f'Only {max(row.stock_quantity or 0, 0)} x {line.name} in stock. Receive more or change the job before completing it.')
        gap = outlets.short(session, line.catalog_item_id, line.quantity)
        if gap: raise HTTPException(409, f'Only {gap[0]} x {line.name} at {gap[1]}. Transfer more there before completing the job.')
        valued = consume(session, actor, key, line.catalog_item_id, line.quantity, day)
        cost += valued[0] if valued is not None else row.cost_price * line.quantity
        if valued is not None and valued[1]:
            allowance_post(session, actor, uuid5(key, 'allowance:' + str(line.catalog_item_id)), day, -valued[1], 'Fulfillment of inventory allowance')
        raw(session, 'UPDATE public.catalog_items SET stock_quantity=stock_quantity-%s WHERE business_id=%s AND id=%s', (line.quantity, tenant, str(line.catalog_item_id)))
        raw(session, 'INSERT INTO accounting.stock_event(business_id,source_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s)',
            (tenant, str(key), str(line.catalog_item_id), -line.quantity, row.cost_price))
    cost = cost.quantize(Decimal('0.01'))
    if cost:
        stock_key = uuid5(key, 'materials')
        post_command(session, actor, PostingCommand(request_key=stock_key, source_id=stock_key, kind='adjustment', main_account_id=purpose(session, 'inventory'),
            entry_date=day, narration='Materials used on a job', credited=True,
            lines=[{'account_id': purpose(session, 'cogs'), 'amount': format(cost, '.2f'), 'credited': False}]), managed_stock=True)
        raw(session, 'INSERT INTO accounting.inventory_journal(business_id,source_id) VALUES(%s,%s)', (tenant, str(stock_key)))
    return cost


def complete(session, actor, job_id: UUID, data: JobComplete):
    def execute():
        key = UUID(str(job_id)); job = _job(session, key, lock=True)
        if job.status not in {'open', 'in_progress'}: raise HTTPException(409, f'This job is already {job.status.replace("_", " ")}')
        lines = _lines(session, key)
        if not lines: raise HTTPException(422, 'Add the services and materials the job used before completing it')
        cost = _issue(session, actor, data.request_key, lines, business_today(session))
        raw(session, "UPDATE public.jobs SET status='completed',completed_at=now(),materials_cost=%s WHERE business_id=%s AND id=%s",
            (cost, str(session.business_id), str(key)))
        raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,%s,'job_completed',%s::jsonb)",
            (str(session.business_id), str(actor), str(data.request_key), json.dumps({'job_id': str(key), 'materials_cost': _money(cost)})))
        return detail(session, actor, key)
    return durable(session, actor, 'job_complete:' + str(job_id), data, execute)


def billable_job(session, job_id):
    """Locks a completed, unbilled job; returns it, its lines and the tracked materials it already issued."""
    job = _job(session, job_id, lock=True)
    if job.status != 'completed': raise HTTPException(409, 'Complete the job before billing it')
    if job.bill_kind: raise HTTPException(409, 'This job has already been billed')
    lines = _lines(session, job_id)
    return job, lines, frozenset(str(l.catalog_item_id) for l in lines if l.tracked)


def mark_job_billed(session, job_id, kind, bill_id):
    raw(session, 'UPDATE public.jobs SET bill_kind=%s,bill_id=%s,billed_at=now() WHERE business_id=%s AND id=%s',
        (kind, str(bill_id), str(session.business_id), str(job_id)))


def bill_invoice(session, actor, job_id: UUID, data: JobInvoice):
    """Issues an invoice for a completed job's lines at catalogue prices to its customer."""
    def execute():
        from cacu.accounting.workflows import InvoiceCreate, invoice_create
        key = UUID(str(job_id)); job, lines, preissued = billable_job(session, key)
        customer = job.customer_id or data.customer_id
        if customer is None: raise HTTPException(422, 'Choose the customer to invoice')
        if job.customer_id and data.customer_id and str(data.customer_id) != str(job.customer_id): raise HTTPException(422, 'This job is for another customer')
        number = job.number or ('JOB-' + str(key)[:8].upper())
        invoice = invoice_create(session, actor, InvoiceCreate(request_key=uuid5(data.request_key, 'invoice'), customer_id=customer, invoice_number=number,
            entry_date=business_today(session), notes=job.title,
            items=[{'catalog_item_id': l.catalog_item_id, 'quantity': int(l.quantity), 'unit_price': format(l.unit_price, '.2f')} for l in lines]),
            preissued=preissued)
        mark_job_billed(session, key, 'invoice', invoice['id'])
        total = sum((l.unit_price * l.quantity for l in lines), ZERO)
        return {'job_id': str(key), 'invoice_id': invoice['id'], 'invoice_number': number, 'total': _money(total)}
    return durable(session, actor, 'job_invoice:' + str(job_id), data, execute)


def cost_rates(session):
    rows = raw(session, 'SELECT staff_id,hourly FROM accounting.staff_cost_rate WHERE business_id=%s', (str(session.business_id),)).all()
    return {'available': costing_allowed(session), 'rates': {str(r.staff_id): _money(r.hourly) for r in rows}}


def save_cost_rates(session, actor, data: CostRates):
    if not costing_allowed(session): raise HTTPException(403, 'Job profit comes with the Chairman plan. Upgrade in Billing to use it.')
    if role(session, actor) != 'owner': raise HTTPException(403, 'Only the business owner can set staff cost rates')
    tenant = str(session.business_id)
    staff = {str(r.id) for r in raw(session, 'SELECT id FROM public.service_staff WHERE business_id=%s', (tenant,)).all()}
    for rate in data.rates:
        if str(rate.staff_id) not in staff: raise HTTPException(422, 'Cost rates are set for your own staff')
        raw(session, """INSERT INTO accounting.staff_cost_rate(business_id,staff_id,hourly,updated_by) VALUES(%s,%s,%s,%s)
          ON CONFLICT (business_id,staff_id) DO UPDATE SET hourly=EXCLUDED.hourly,updated_by=EXCLUDED.updated_by,updated_at=now()""",
            (tenant, str(rate.staff_id), Decimal(rate.hourly), str(actor)))
    raw(session, "INSERT INTO accounting.audit_event(business_id,actor_id,request_key,event,details) VALUES(%s,%s,gen_random_uuid(),'staff_cost_rates',%s::jsonb)",
        (tenant, str(actor), json.dumps({'staff': len(data.rates)})))
    return cost_rates(session)


def detail(session, actor, job_id: UUID):
    """A job's lines, revenue at catalogue prices, materials at cost (issued, or estimated before completion) and,
    on Chairman for people who can see the ledger, labour at cost and profit."""
    job = _job(session, job_id); lines = _lines(session, job_id)
    revenue = sum((l.unit_price * l.quantity for l in lines), ZERO)
    materials = job.materials_cost if job.materials_cost is not None else sum(((l.cost_price or ZERO) * l.quantity for l in lines if l.item_type == 'PRODUCT'), ZERO)
    result = {'id': str(job.id), 'number': job.number, 'status': job.status, 'bill_kind': job.bill_kind, 'bill_id': str(job.bill_id) if job.bill_id else None,
              'revenue': _money(revenue), 'materials_cost': _money(materials), 'materials_issued': job.materials_cost is not None,
              'lines': [{'item_id': str(l.catalog_item_id), 'name': l.name, 'kind': 'service' if l.item_type == 'SERVICE' else 'material',
                         'quantity': int(l.quantity), 'unit_price': _money(l.unit_price), 'total': _money(l.unit_price * l.quantity)} for l in lines],
              'profit': None}
    if costing_allowed(session) and allowed(session, 'ledger.view'):
        labour = raw(session, """SELECT coalesce(sum(j.minutes*coalesce(r.hourly,0)/60.0),0) AS cost, count(*) FILTER (WHERE r.hourly IS NULL) AS unrated
          FROM public.job_labour j LEFT JOIN accounting.staff_cost_rate r ON r.business_id=j.business_id AND r.staff_id=j.staff_id
          WHERE j.business_id=%s AND j.job_id=%s""", (str(session.business_id), str(job_id))).one()
        labour_cost = Decimal(labour.cost).quantize(Decimal('0.01'))
        result['profit'] = {'labour_cost': _money(labour_cost), 'profit': _money(revenue - materials - labour_cost),
                            'unrated_entries': int(labour.unrated)}
    return result
