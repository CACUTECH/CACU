"""Legacy invoice creation on the server (BR-003, ACC-004, ACC-005, ACC-015) on disposable PostgreSQL fixtures."""
import json
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed, database, URL
from test_legacy_write_boundary_postgres import boundary, run

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
SIGNATURE = 'uuid,uuid,text,text,text,date,date,numeric,numeric,numeric,boolean,text,jsonb'


@pytest.fixture
def invoicing(boundary):
    d, legacy, other, people = boundary
    customer, foreign_customer, rice, beans, archived, foreign_item = (uuid4() for _ in range(6))
    with psycopg.connect(URL) as c:
        # Mirror hosted defaults and numbering uniqueness.
        c.execute("""ALTER TABLE public.invoices ALTER COLUMN id SET DEFAULT gen_random_uuid(),
            ADD CONSTRAINT invoices_business_id_invoice_number_key UNIQUE (business_id, invoice_number);
          ALTER TABLE public.invoice_items ALTER COLUMN id SET DEFAULT gen_random_uuid()""")
        c.execute(f'CREATE FUNCTION public.create_invoice_atomic({SIGNATURE}) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$')
        c.execute(f'GRANT EXECUTE ON FUNCTION public.create_invoice_atomic({SIGNATURE}) TO authenticated')
        c.execute('INSERT INTO customers(id,business_id,name) VALUES(%s,%s,%s),(%s,%s,%s)',
                  (customer, legacy, 'Ada Stores', foreign_customer, other, 'Other'))
        c.execute("""INSERT INTO catalog_items(id,business_id,name,item_type,stock_quantity,cost_price,unit_price,is_active) VALUES
            (%s,%s,'Rice 50kg','PRODUCT',10,50000,65000.50,true),(%s,%s,'Beans','PRODUCT',10,1,1200,true),
            (%s,%s,'Old item','PRODUCT',0,1,10,false),(%s,%s,'Foreign','PRODUCT',1,1,10,true)""",
                  (rice, legacy, beans, legacy, archived, legacy, foreign_item, other))
        c.execute(Path('../supabase/migrations/20261030110000_legacy_invoice_creation.sql').read_text(encoding='utf-8'))
    return d, legacy, other, people, {'customer': customer, 'foreign_customer': foreign_customer, 'rice': rice,
                                      'beans': beans, 'archived': archived, 'foreign_item': foreign_item}


def create(business, actor, items, key=None, kind='Invoice', customer=None, vat=False, issue=None, due=None):
    return run(actor, 'SELECT public.create_invoice_safe(%s,%s,%s,%s,%s,%s,%s,%s,%s)',
               (business, key or uuid4(), kind, customer, issue, due, vat, 'Thanks', json.dumps(items)))[0][0]


def lines(*pairs):
    return [{'catalog_item_id': str(item), 'quantity': qty, 'unit_price': '1.00'} for item, qty in pairs]


def test_invoice_uses_catalogue_prices_server_totals_and_payable_status(invoicing):
    _, legacy, _, people, ids = invoicing
    created = create(legacy, people['editor'], lines((ids['rice'], 2), (ids['beans'], '1.5')), customer=ids['customer'])
    assert created['status'] == 'sent' and created['invoice_number'] == 'INV-000001' and created['replayed'] is False
    assert Decimal(str(created['total'])) == Decimal('131801.00')
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT type,status,subtotal,tax,total,vat_included FROM invoices WHERE id=%s', (created['id'],)).fetchone() == \
            ('Invoice', 'sent', Decimal('131801.00'), 0, Decimal('131801.00'), False)
        assert c.execute('SELECT description,quantity,unit_price,line_total FROM invoice_items WHERE invoice_id=%s ORDER BY line_total DESC',
                         (created['id'],)).fetchall() == [('Rice 50kg', 2, Decimal('65000.5000'), Decimal('130001.00')),
                                                          ('Beans', Decimal('1.5'), Decimal('1200.0000'), Decimal('1800.00'))]
        assert c.execute("SELECT action FROM audit_logs WHERE record_id=%s", (created['id'],)).fetchall() == [('INVOICE_CREATED',)]


def test_numbers_are_sequential_per_type_and_estimates_stay_draft(invoicing):
    _, legacy, _, people, ids = invoicing
    numbers = [create(legacy, people['owner'], lines((ids['beans'], 1)), customer=ids['customer'])['invoice_number'] for _ in range(2)]
    estimate = create(legacy, people['owner'], lines((ids['beans'], 1)), kind='Estimate')
    assert numbers == ['INV-000001', 'INV-000002']
    assert (estimate['invoice_number'], estimate['status']) == ('EST-000001', 'draft')


def test_retry_replays_and_changed_payload_is_refused(invoicing):
    _, legacy, _, people, ids = invoicing
    key = uuid4()
    first = create(legacy, people['editor'], lines((ids['beans'], 1)), key=key, customer=ids['customer'])
    again = create(legacy, people['editor'], lines((ids['beans'], 1)), key=key, customer=ids['customer'])
    assert again['replayed'] is True and again['id'] == first['id']
    with pytest.raises(psycopg.Error, match='REQUEST_KEY_REUSED'):
        create(legacy, people['editor'], lines((ids['beans'], 2)), key=key, customer=ids['customer'])
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM invoices WHERE business_id=%s', (legacy,)).fetchone() == (1,)


@pytest.mark.parametrize('case,error', [
    ({'kind': 'Receipt'}, 'UNSUPPORTED_DOCUMENT'), ({'kind': 'CreditMemo'}, 'UNSUPPORTED_DOCUMENT'),
    ({'vat': True}, 'TAX_NOT_CONFIGURED'), ({'customer': None}, 'CUSTOMER_REQUIRED'),
    ({'customer': 'foreign_customer'}, 'CUSTOMER_NOT_FOUND'), ({'item': 'foreign_item'}, 'ITEM_NOT_FOUND'),
    ({'item': 'archived'}, 'ITEM_NOT_FOUND'), ({'qty': 0}, 'INVALID_INVOICE'), ({'qty': '0.0001'}, 'INVALID_INVOICE'),
    ({'items': []}, 'INVALID_INVOICE'), ({'issue': '2999-01-01'}, 'INVALID_INVOICE'),
    ({'issue': '2026-01-10', 'due': '2026-01-01'}, 'INVALID_INVOICE')])
def test_invalid_documents_are_refused_and_write_nothing(invoicing, case, error):
    _, legacy, _, people, ids = invoicing
    customer = case.get('customer', 'customer')
    items = case.get('items', lines((ids[case.get('item', 'beans')], case.get('qty', 1))))
    with pytest.raises(psycopg.Error, match=error):
        create(legacy, people['owner'], items, kind=case.get('kind', 'Invoice'), vat=case.get('vat', False),
               customer=ids[customer] if customer else None, issue=case.get('issue'), due=case.get('due'))
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM invoices').fetchone() == (0,)
        assert c.execute('SELECT count(*) FROM invoice_items').fetchone() == (0,)


@pytest.mark.parametrize('role', ['viewer', 'outsider'])
def test_viewers_and_other_tenants_cannot_create_invoices(invoicing, role):
    _, legacy, _, people, ids = invoicing
    with pytest.raises(psycopg.Error, match='ACCESS_DENIED'):
        create(legacy, people[role], lines((ids['beans'], 1)), customer=ids['customer'])


def test_activated_business_must_use_accounting_postings(invoicing):
    d, _, _, _, ids = invoicing
    with pytest.raises(psycopg.Error, match='USE_ACCOUNTING_POSTINGS'):
        create(d[1], d[2], lines((ids['beans'], 1)), customer=ids['customer'])


def test_old_client_priced_writer_is_no_longer_callable(invoicing):
    _, legacy, _, people, _ = invoicing
    with psycopg.connect(URL) as c:
        assert c.execute(f"SELECT has_function_privilege('authenticated','public.create_invoice_atomic({SIGNATURE})','EXECUTE')").fetchone() == (False,)
        assert c.execute("SELECT has_function_privilege('anon','public.create_invoice_safe(uuid,uuid,text,uuid,date,date,boolean,text,jsonb)','EXECUTE')").fetchone() == (False,)
