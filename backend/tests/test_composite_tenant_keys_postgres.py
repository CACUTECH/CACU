"""M-05 composite tenant keys (GAP-04, SEC-002, TEST-002) on a disposable copy of the hosted foreign keys."""
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
import psycopg
import pytest

DSN = os.getenv('CACU_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not DSN, reason='Disposable PostgreSQL required')
MIGRATION = Path('../supabase/migrations/20261031090000_composite_tenant_keys.sql')

# Hosted single-column keys and delete actions on 29 October 2026 (read-only catalogue query).
HOSTED = """
CREATE TABLE public.businesses(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses);
CREATE TABLE public.suppliers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid REFERENCES public.businesses);
CREATE TABLE public.catalog_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, supplier_id uuid REFERENCES public.suppliers(id),
  UNIQUE (id, business_id));
CREATE TABLE public.accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL);
CREATE TABLE public.employees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL);
CREATE TABLE public.invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL);
CREATE TABLE public.transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL);
CREATE TABLE public.payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL, invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL);
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL);
CREATE TABLE public.payment_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, payment_id uuid REFERENCES public.payments(id) ON DELETE CASCADE);
CREATE TABLE public.invoice_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE, catalog_item_id uuid REFERENCES public.catalog_items(id) ON DELETE SET NULL);
CREATE TABLE public.transaction_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE, catalog_item_id uuid REFERENCES public.catalog_items(id) ON DELETE SET NULL);
CREATE TABLE public.journal_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL);
CREATE TABLE public.journal_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE, account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT);
CREATE TABLE public.appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL);
CREATE TABLE public.jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL);
CREATE TABLE public.attendance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE);
CREATE TABLE public.hr_payslips(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, employee_id uuid NOT NULL REFERENCES public.employees(id));
CREATE TABLE public.payroll_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL);
CREATE TABLE public.payslips(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT, payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE);
"""


@pytest.fixture
def hosted():
    parsed = urlparse(DSN)
    assert parsed.hostname in {'localhost', '127.0.0.1', 'postgres'} and parsed.path.endswith('_test')
    a, b = uuid4(), uuid4()
    with psycopg.connect(DSN) as c:
        c.execute('DROP SCHEMA IF EXISTS accounting CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        c.execute(HOSTED)
        c.execute('INSERT INTO businesses VALUES (%s), (%s)', (a, b))
        ids = {}
        for business, tag in ((a, 'a'), (b, 'b')):
            ids[f'customer_{tag}'] = c.execute('INSERT INTO customers(business_id) VALUES (%s) RETURNING id', (business,)).fetchone()[0]
            ids[f'item_{tag}'] = c.execute('INSERT INTO catalog_items(business_id) VALUES (%s) RETURNING id', (business,)).fetchone()[0]
            ids[f'employee_{tag}'] = c.execute('INSERT INTO employees(business_id) VALUES (%s) RETURNING id', (business,)).fetchone()[0]
    return a, b, ids


def apply(c):
    c.execute(MIGRATION.read_text(encoding='utf-8'))


def test_every_reference_becomes_a_composite_tenant_key(hosted):
    with psycopg.connect(DSN) as c:
        apply(c)
        single = c.execute("""SELECT conrelid::regclass::text, conname FROM pg_constraint
          WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND confrelid <> 'public.businesses'::regclass
            AND array_length(conkey, 1) = 1""").fetchall()
        composite = c.execute("""SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace
            AND convalidated AND array_length(conkey, 1) = 2 AND confrelid <> 'public.businesses'::regclass""").fetchone()[0]
        nullable = c.execute("""SELECT table_name FROM information_schema.columns WHERE table_schema = 'public'
            AND column_name = 'business_id' AND is_nullable = 'YES' AND table_name IN ('attendance', 'payment_events', 'suppliers')""").fetchall()
    assert single == [] and composite == 20 and nullable == []


@pytest.mark.parametrize('sql,args', [
    ('INSERT INTO invoices(business_id, customer_id) VALUES (%s, %s)', ('a', 'customer_b')),
    ('INSERT INTO transactions(business_id, customer_id) VALUES (%s, %s)', ('a', 'customer_b')),
    ('INSERT INTO payments(business_id, customer_id) VALUES (%s, %s)', ('a', 'customer_b')),
    ('INSERT INTO appointments(business_id, customer_id) VALUES (%s, %s)', ('a', 'customer_b')),
    ('INSERT INTO attendance(business_id, employee_id) VALUES (%s, %s)', ('a', 'employee_b')),
])
def test_rows_cannot_reference_another_business(hosted, sql, args):
    a, b, ids = hosted
    values = [a if x == 'a' else ids[x] for x in args]
    with psycopg.connect(DSN) as c:
        apply(c)
    with psycopg.connect(DSN) as c, pytest.raises(psycopg.errors.ForeignKeyViolation):
        c.execute(sql, values)


def test_invoice_line_cannot_use_another_business_item(hosted):
    a, _, ids = hosted
    with psycopg.connect(DSN) as c:
        apply(c)
        invoice = c.execute('INSERT INTO invoices(business_id, customer_id) VALUES (%s, %s) RETURNING id', (a, ids['customer_a'])).fetchone()[0]
        c.execute('INSERT INTO invoice_items(business_id, invoice_id, catalog_item_id) VALUES (%s, %s, %s)', (a, invoice, ids['item_a']))
    with psycopg.connect(DSN) as c, pytest.raises(psycopg.errors.ForeignKeyViolation):
        c.execute('INSERT INTO invoice_items(business_id, invoice_id, catalog_item_id) VALUES (%s, %s, %s)', (a, invoice, ids['item_b']))


def test_customer_with_financial_history_cannot_be_deleted_but_bookings_are_cleared(hosted):
    a, _, ids = hosted
    with psycopg.connect(DSN) as c:
        apply(c)
        spare = c.execute('INSERT INTO customers(business_id) VALUES (%s) RETURNING id', (a,)).fetchone()[0]
        booking = c.execute('INSERT INTO appointments(business_id, customer_id) VALUES (%s, %s) RETURNING id', (a, spare)).fetchone()[0]
        c.execute('INSERT INTO invoices(business_id, customer_id) VALUES (%s, %s)', (a, ids['customer_a']))
    with psycopg.connect(DSN) as c, pytest.raises(psycopg.errors.ForeignKeyViolation):
        c.execute('DELETE FROM customers WHERE id = %s', (ids['customer_a'],))
    with psycopg.connect(DSN) as c:
        c.execute('DELETE FROM customers WHERE id = %s', (spare,))
        assert c.execute('SELECT business_id, customer_id FROM appointments WHERE id = %s', (booking,)).fetchone() == (a, None)


def test_invoice_lines_and_payment_history_no_longer_cascade(hosted):
    a, _, ids = hosted
    with psycopg.connect(DSN) as c:
        apply(c)
        invoice = c.execute('INSERT INTO invoices(business_id, customer_id) VALUES (%s, %s) RETURNING id', (a, ids['customer_a'])).fetchone()[0]
        c.execute('INSERT INTO invoice_items(business_id, invoice_id) VALUES (%s, %s)', (a, invoice))
    with psycopg.connect(DSN) as c, pytest.raises(psycopg.errors.ForeignKeyViolation):
        c.execute('DELETE FROM invoices WHERE id = %s', (invoice,))


def test_existing_cross_tenant_rows_stop_the_migration_and_change_nothing(hosted):
    a, _, ids = hosted
    with psycopg.connect(DSN) as c:
        c.execute('INSERT INTO invoices(business_id, customer_id) VALUES (%s, %s)', (a, ids['customer_b']))
    with psycopg.connect(DSN) as c, pytest.raises(psycopg.Error, match=r'CROSS_TENANT_REFERENCES invoices\.customer_id: 1;'):
        apply(c)
    with psycopg.connect(DSN) as c:
        assert c.execute("""SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND array_length(conkey, 1) = 2
            AND connamespace = 'public'::regnamespace AND confrelid <> 'public.businesses'::regclass""").fetchone() == (0,)
        assert c.execute("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'attendance' AND column_name = 'business_id'").fetchone() == ('YES',)
