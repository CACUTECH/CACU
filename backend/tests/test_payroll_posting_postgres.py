"""Payroll to the books (Doc 03 FR-203; E21 R4): off until the R4 gate; an Owner or Admin posts an approved run as one
balanced journal built from its totals; paying staff and remitting deductions clear exactly what is owed and never
more; a posted run cannot be cancelled in HR; postings and payments are never edited."""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.payroll import PostRun, Settle, overview, post_run, settle
from test_corrections_postgres import live, call, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_activation_postgres import TODAY

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
PERIOD = TODAY.replace(day=1)
# One run: gross 500,000; PAYE 40,000; pension 8% of 400,000 and employer 10%; NHF 5,000; NHIS 3,000.
TOTALS = {'gross_total': '500000.00', 'paye_total': '40000.00', 'pension_employee_total': '32000.00', 'pension_employer_total': '40000.00',
          'nhf_total': '5000.00', 'nhis_total': '3000.00', 'net_total': '420000.00'}


def switch(on):
    with psycopg.connect(URL) as c:
        c.execute('UPDATE accounting.payroll_switch SET enabled=%s, changed_at=now()', (on,))


def payroll_run(live, status='approved', **changes):
    """The HR payroll run, as hr_write leaves it (the accounting test schema has no HR tables of its own)."""
    totals = {**TOTALS, **changes}
    with psycopg.connect(URL) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS public.hr_payroll_runs(id uuid PRIMARY KEY, business_id uuid NOT NULL, period date NOT NULL,
            status text NOT NULL, approved_at timestamptz, employee_count integer NOT NULL, gross_total numeric(15,2) NOT NULL,
            paye_total numeric(15,2) NOT NULL, pension_employee_total numeric(15,2) NOT NULL, pension_employer_total numeric(15,2) NOT NULL,
            nhf_total numeric(15,2) NOT NULL, nhis_total numeric(15,2) NOT NULL, net_total numeric(15,2) NOT NULL)""")
        # The migration attaches this guard where HR exists (production); here the table is made after it ran.
        c.execute('DROP TRIGGER IF EXISTS payroll_run_posted_guard ON public.hr_payroll_runs')
        c.execute('CREATE TRIGGER payroll_run_posted_guard BEFORE UPDATE ON public.hr_payroll_runs FOR EACH ROW EXECUTE FUNCTION accounting.payroll_run_posted_guard()')
        ident = uuid4()
        c.execute("""INSERT INTO public.hr_payroll_runs(id, business_id, period, status, approved_at, employee_count, gross_total, paye_total,
            pension_employee_total, pension_employer_total, nhf_total, nhis_total, net_total)
            VALUES (%s,%s,%s,%s,CASE WHEN %s='approved' THEN now() END,3,%s,%s,%s,%s,%s,%s,%s)""",
                  (ident, live.business, PERIOD, status, status, *[totals[k] for k in TOTALS]))
    return ident


def balance(live, purpose):
    """What the books owe on an account (credits less debits), found by its purpose."""
    with psycopg.connect(URL) as c:
        return c.execute("""SELECT coalesce(sum(CASE WHEN l.entry_type::text='CREDIT' THEN l.amount ELSE -l.amount END),0)
            FROM accounting.ledger l JOIN accounting.account_map m ON m.library_id=l.post_account_id AND m.business_id=l.business_id
            WHERE l.business_id=%s AND m.purpose=%s""", (live.business, purpose)).fetchone()[0]


def pay(kind, amount, when=TODAY, key=None, method='Cash'):
    return Settle(request_key=key or uuid4(), kind=kind, amount=amount, entry_date=when, method=method)


def test_off_until_the_r4_gate(live):
    switch(False)
    assert call(live, 'owner', lambda s, a: overview(s, a))['enabled'] is False
    run = payroll_run(live)
    with pytest.raises(HTTPException) as refused:
        call(live, 'owner', lambda s, a: post_run(s, a, run, PostRun(request_key=uuid4())))
    assert (refused.value.status_code, refused.value.detail) == (409, 'Posting payroll to the books is not available yet.')


def test_an_approved_run_posts_one_balanced_journal_once(live):
    switch(True)
    draft = payroll_run(live, status='draft')
    with pytest.raises(HTTPException, match='Approve this payroll run'):
        call(live, 'owner', lambda s, a: post_run(s, a, draft, PostRun(request_key=uuid4())))
    run = payroll_run(live)
    with pytest.raises(HTTPException) as refused:
        call(live, 'editor', lambda s, a: post_run(s, a, run, PostRun(request_key=uuid4())))
    assert refused.value.status_code == 403
    posted = call(live, 'admin', lambda s, a: post_run(s, a, run, PostRun(request_key=uuid4())))
    assert posted['posted']['entry_date'] == min((PERIOD.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1), TODAY).isoformat()
    assert posted['outstanding'] == {'net_pay': '420000.00', 'paye': '40000.00', 'pension': '72000.00', 'nhf': '5000.00', 'nhis': '3000.00'}
    assert (balance(live, 'salaries_payable'), balance(live, 'paye_payable'), balance(live, 'pension_payable'),
            balance(live, 'nhf_payable'), balance(live, 'nhis_payable')) == (Decimal('420000'), Decimal('40000'), Decimal('72000'), Decimal('5000'), Decimal('3000'))
    assert balance(live, 'employer_pension') == Decimal('-40000')  # a debit: the employer's cost
    with psycopg.connect(URL) as c:
        debit, credit = c.execute("""SELECT sum(amount) FILTER (WHERE entry_type::text='DEBIT'), sum(amount) FILTER (WHERE entry_type::text='CREDIT')
            FROM accounting.ledger WHERE business_id=%s AND transaction_id=%s""", (live.business, posted['posted']['transaction_id'])).fetchone()
        assert debit == credit == Decimal('540000')  # gross 500,000 plus employer pension 40,000
        codes = dict(c.execute("""SELECT m.purpose, a.code FROM accounting.account_map m JOIN public.accounts a ON a.id=m.account_id
            WHERE m.business_id=%s AND m.purpose LIKE '%%payable' AND m.purpose NOT IN ('vat_output')""", (live.business,)).fetchall())
        assert {codes[k][:3] for k in ('salaries_payable', 'paye_payable', 'pension_payable', 'nhf_payable', 'nhis_payable')} == {'230', '231', '232', '233', '234'}
    again = call(live, 'owner', lambda s, a: post_run(s, a, run, PostRun(request_key=uuid4())))
    assert again['posted'] == posted['posted']  # posting again returns what was posted
    with psycopg.connect(URL) as c:
        assert c.execute("SELECT count(*) FROM accounting.document_map WHERE business_id=%s AND source_type='payroll'", (live.business,)).fetchone()[0] == 1
    listed = call(live, 'owner', lambda s, a: overview(s, a))
    assert listed['enabled'] and [r['run']['id'] for r in listed['runs'] if r['posted']] == [str(run)] and listed['pay_from']['cash']


def test_a_run_that_does_not_add_up_is_refused(live):
    switch(True)
    run = payroll_run(live, net_total='421000.00')
    with pytest.raises(HTTPException, match='does not add up'):
        call(live, 'owner', lambda s, a: post_run(s, a, run, PostRun(request_key=uuid4())))


def test_paying_staff_and_remitting_clear_what_is_owed_and_never_more(live):
    switch(True)
    run = payroll_run(live)
    with pytest.raises(HTTPException, match='Post this payroll'):
        call(live, 'owner', lambda s, a: settle(s, a, run, pay('net_pay', '1000.00')))
    call(live, 'owner', lambda s, a: post_run(s, a, run, PostRun(request_key=uuid4())))
    key = uuid4()
    first = call(live, 'owner', lambda s, a: settle(s, a, run, pay('net_pay', '400000.00', key=key)))
    assert first['outstanding']['net_pay'] == '20000.00'
    assert call(live, 'owner', lambda s, a: settle(s, a, run, pay('net_pay', '400000.00', key=key)))['outstanding']['net_pay'] == '20000.00'  # a retry
    with pytest.raises(HTTPException, match='Only ₦20,000.00 is still owed'):
        call(live, 'owner', lambda s, a: settle(s, a, run, pay('net_pay', '20000.01')))
    with pytest.raises(HTTPException, match='in the future'):
        call(live, 'owner', lambda s, a: settle(s, a, run, pay('paye', '40000.00', when=TODAY + timedelta(days=1))))
    call(live, 'owner', lambda s, a: settle(s, a, run, pay('net_pay', '20000.00')))
    for kind, amount in (('paye', '40000.00'), ('pension', '72000.00'), ('nhf', '5000.00'), ('nhis', '3000.00')):
        done = call(live, 'admin', lambda s, a: settle(s, a, run, pay(kind, amount)))
    assert done['outstanding'] == {k: '0.00' for k in ('net_pay', 'paye', 'pension', 'nhf', 'nhis')}
    assert [s['kind'] for s in done['settlements']] == ['net_pay', 'net_pay', 'paye', 'pension', 'nhf', 'nhis']
    for purpose in ('salaries_payable', 'paye_payable', 'pension_payable', 'nhf_payable', 'nhis_payable'):
        assert balance(live, purpose) == 0

    with psycopg.connect(URL) as c:  # a run in the books cannot be cancelled in HR
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState, match='PAYROLL_RUN_POSTED'):
            c.execute("UPDATE public.hr_payroll_runs SET status='cancelled' WHERE id=%s", (run,))
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            c.execute('UPDATE accounting.payroll_settlement SET amount=1')
    with psycopg.connect(URL) as c:
        with pytest.raises(psycopg.errors.ObjectNotInPrerequisiteState):
            c.execute('DELETE FROM accounting.payroll_posting')
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL ROLE cacu_runtime')
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute('UPDATE accounting.payroll_switch SET enabled=true')


def test_payroll_kinds_cannot_be_posted_through_the_generic_route(live):
    from cacu.accounting.posting import PostingCommand, PostingLine, post_command
    switch(True)
    with pytest.raises(HTTPException) as refused:
        call(live, 'owner', lambda s, a: post_command(s, a, PostingCommand(
            request_key=uuid4(), kind='payroll_payment', source_id=uuid4(), main_account_id=uuid4(), entry_date=TODAY,
            narration='Sneaky', lines=[PostingLine(account_id=uuid4(), amount='1.00')])))
    assert refused.value.status_code == 422
