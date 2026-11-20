"""Purchasing, part 1 (Doc 10 purchase-to-payment and rules): purchase orders to a supplier, numbered PO-0001, drafted,
sent and cancelled through the Data API under the database's rules, with lines only on drafts and receiving left to
the accounting API. A purchase order posts nothing. On a business started from the real chart."""
from uuid import uuid4
import psycopg
import pytest
from test_corrections_postgres import live, balance, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template
from test_pos_refunds_postgres import as_member, books_balance
from test_pos_shifts_postgres import on_plan

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def order(live, who='owner', **kw):
    columns = {'business_id': live.business, 'supplier_id': live.ids['supplier'], 'notes': '', **kw}
    return as_member(live, who, f'INSERT INTO purchase_orders({",".join(columns)}) VALUES({",".join(["%s"] * len(columns))}) RETURNING id,number,status',
                     *columns.values())[0]


def line(live, order_id, name, quantity, cost='1200.50', who='owner'):
    return as_member(live, who, 'INSERT INTO purchase_order_lines(business_id,order_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,%s,%s) RETURNING id',
                     live.business, order_id, live.items[name], quantity, cost)


def status(live, order_id, sql, *args, who='owner'):
    return as_member(live, who, f'UPDATE purchase_orders SET {sql} WHERE id=%s RETURNING status', *args, order_id)


def test_an_order_is_drafted_sent_and_cancelled_and_posts_nothing(live):
    stock_value, payables = balance(live, '1200'), balance(live, '2000')
    first = order(live)
    assert first[1:] == ('PO-0001', 'draft') and order(live)[1] == 'PO-0002'
    with pytest.raises(psycopg.errors.CheckViolation, match='ORDER_EMPTY'):
        status(live, first[0], "status='sent'")
    line(live, first[0], 'Beans', 24)
    line(live, first[0], 'Rice', 5, '50000')
    with pytest.raises(psycopg.errors.UniqueViolation):
        line(live, first[0], 'Beans', 1)
    assert status(live, first[0], "status='sent'") == [('sent',)]
    with pytest.raises(psycopg.errors.CheckViolation, match='ORDER_SENT'):
        line(live, first[0], 'Beans', 1)  # lines change only on a draft
    with pytest.raises(psycopg.errors.CheckViolation, match='ORDER_SENT'):
        as_member(live, 'owner', 'UPDATE purchase_order_lines SET quantity=30 WHERE order_id=%s RETURNING id', first[0])
    with pytest.raises(psycopg.errors.CheckViolation, match='ORDER_RECEIVED_BY_API'):
        status(live, first[0], "status='received'")
    with pytest.raises(psycopg.errors.CheckViolation, match='ORDER_RECEIVED_BY_API'):
        as_member(live, 'owner', 'UPDATE purchase_order_lines SET received_quantity=24 WHERE order_id=%s RETURNING id', first[0])
    with pytest.raises(psycopg.errors.CheckViolation, match='CANCEL_REASON_REQUIRED'):
        status(live, first[0], "status='cancelled'")
    assert status(live, first[0], "status='cancelled',cancel_reason=%s", 'Supplier out of stock') == [('cancelled',)]
    with pytest.raises(psycopg.errors.CheckViolation, match='ORDER_CLOSED'):
        status(live, first[0], "notes='late'")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_member(live, 'owner', 'DELETE FROM purchase_orders WHERE id=%s RETURNING id', first[0])
    assert balance(live, '1200') == stock_value and balance(live, '2000') == payables  # nothing posts
    books_balance(live)


def test_lines_are_stocked_products_and_people_draft_or_send_by_their_permissions(live):
    draft = order(live)[0]
    with psycopg.connect(URL) as c:
        c.execute('SET LOCAL session_replication_role = replica')  # test setup: a service and an untracked product
        service, loose = uuid4(), uuid4()
        c.execute("""INSERT INTO catalog_items(id,business_id,name,item_type,unit_price,is_active) VALUES
                     (%s,%s,'Delivery','SERVICE',2000,true),(%s,%s,'Gift wrap','PRODUCT',100,true)""", (service, live.business, loose, live.business))
        c.execute('ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS track_stock boolean')
        c.execute('UPDATE catalog_items SET track_stock=false WHERE id=%s', (loose,))
    for item in (service, loose, uuid4()):
        with pytest.raises(psycopg.errors.CheckViolation, match='ITEM_UNAVAILABLE'):
            as_member(live, 'owner', 'INSERT INTO purchase_order_lines(business_id,order_id,item_id,quantity,unit_cost) VALUES(%s,%s,%s,1,1) RETURNING id',
                      live.business, draft, item)
    with pytest.raises(psycopg.errors.CheckViolation, match='SUPPLIER_UNAVAILABLE'):
        order(live, supplier_id=uuid4())
    as_template(live, 'editor', 'bookkeeper')  # drafts orders, cannot send them
    mine = order(live, 'editor')[0]
    line(live, mine, 'Beans', 2, who='editor')
    assert status(live, mine, "status='sent'", who='editor') == []
    as_template(live, 'viewer', 'cashier')  # sees orders, cannot draft them
    assert [r[0] for r in as_member(live, 'viewer', 'SELECT number FROM purchase_orders ORDER BY number')] == ['PO-0001', 'PO-0002']
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        order(live, 'viewer')


def test_purchase_orders_come_with_the_oga_and_chairman_plans(live):
    on_plan(live, 'BASE')
    assert as_member(live, 'owner', 'SELECT public.purchasing_allowed(%s)', live.business) == [(False,)]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        order(live)
    on_plan(live, 'GROW')
    assert as_member(live, 'owner', 'SELECT public.purchasing_allowed(%s)', live.business) == [(True,)]
    assert order(live)[1] == 'PO-0001'
