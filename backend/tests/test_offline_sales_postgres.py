"""Offline selling, part 1 (Doc 10 E17, Doc 13; owner decisions of 7 November 2026): a sale made offline posts on sync at
the prices it was sold at when those were the catalogue prices then, dated when it was made; stock that ran short is a
listed shortfall; anything else waits for someone who approves sales, who posts or discards it. Nothing posts twice."""
from datetime import datetime, timedelta, timezone
import json
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo
import psycopg
import pytest
from fastapi import HTTPException
from cacu.accounting.offline import OfflineDecision, OfflineSale, decide, review_list, sync
from cacu.accounting.workflows import sale_create
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_checkout_postgres import as_template, sale
from test_pos_refunds_postgres import books_balance

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')
NOW = lambda: datetime.now(timezone.utc)
LAGOS = ZoneInfo('Africa/Lagos')


def offline(live, lines, ago=timedelta(hours=1), method='Cash', key=None, **kw):
    total = sum(Decimal(price) * qty * (100 - Decimal(pct)) / 100 for _, qty, price, pct in lines)
    sold_at = NOW() - ago
    if ago < timedelta(days=1):  # the test business's books start today (Lagos): keep the sale on today
        midnight = datetime.now(LAGOS).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        sold_at = min(max(sold_at, midnight + (NOW() - midnight) / 2), NOW())
    return OfflineSale(request_key=key or uuid4(), sold_at=sold_at, method=method, quoted_total=format(total.quantize(Decimal('0.01')), 'f'),
                       items=[{'item_id': live.items[n], 'quantity': q, 'unit_price': p, 'discount_percent': pct} for n, q, p, pct in lines], **kw)


def synced(live, data, who='owner'):
    return call(live, who, lambda s, a: sync(s, a, data))


def reprice(live, name, price):
    with psycopg.connect(URL) as c:  # as the catalogue screen does: a metadata change by the owner
        c.execute("SELECT set_config('request.jwt.claims',%s,true),set_config('cacu.catalog_metadata_write','on',true)",
                  (json.dumps({'sub': str(live.people['owner'])}),))
        c.execute('UPDATE catalog_items SET unit_price=%s WHERE id=%s', (price, live.items[name]))


def test_an_offline_sale_posts_once_at_the_price_it_was_sold_at_and_short_stock_is_listed(live):
    beans, cash = stock(live, 'Beans')[0], balance(live, '1000')
    data = offline(live, [('Beans', 2, '1500', '0')], ago=timedelta(hours=3))
    reprice(live, 'Beans', '1800')  # the price went up after the sale
    result = synced(live, data)
    assert result['status'] == 'posted', result
    assert result['shortfalls'] == []
    assert synced(live, data)['status'] == 'posted'  # a retry posts nothing more
    assert stock(live, 'Beans')[0] == beans - 2 and balance(live, '1000') - cash == Decimal('3000')
    short = synced(live, offline(live, [('Beans', beans + 5, '1800', '0')], ago=timedelta(0)))
    assert short['status'] == 'posted', short
    assert short['shortfalls'][0]['quantity'] == 7  # money taken: posted, the shortfall listed
    assert stock(live, 'Beans')[0] == 0

    online = sale(live, lines=(('Rice', 1, '0'),))  # an online attempt that did post, whose answer was lost
    call(live, 'owner', lambda s, a: sale_create(s, a, online))
    again = offline(live, [('Rice', 1, '65000', '0')], key=online.request_key, ago=timedelta(minutes=1))
    assert synced(live, again)['status'] == 'posted'
    with psycopg.connect(URL) as c:
        assert c.execute('SELECT count(*) FROM transactions WHERE id=%s', (online.request_key,)).fetchone()[0] == 1
    with pytest.raises(HTTPException, match='does not add up'):
        synced(live, offline(live, [('Rice', 1, '65000', '0')]).model_copy(update={'quoted_total': '1.00'}))
    books_balance(live)


def test_unusual_offline_sales_wait_for_review_and_an_approver_posts_or_discards_them(live):
    as_template(live, 'editor', 'cashier')
    edited = offline(live, [('Rice', 1, '60000', '0')])  # the catalogue price was 65,000
    assert synced(live, edited, 'editor')['reason'] == 'price'
    old = offline(live, [('Rice', 1, '65000', '0')], ago=timedelta(days=8))
    assert synced(live, old, 'editor')['reason'] == 'too_old'
    generous = offline(live, [('Beans', 1, '1500', '50')])
    assert synced(live, generous, 'editor')['reason'] == 'discount'
    assert synced(live, edited, 'editor')['status'] == 'review'  # a retry finds it waiting

    mine = call(live, 'editor', lambda s, a: review_list(s, a))
    assert mine['can_decide'] is False and {s['reason'] for s in mine['sales']} == {'price', 'too_old', 'discount'}
    assert 'Rice: sold at ₦60,000.00, catalogue price then ₦65,000.00' in {s['detail'] for s in mine['sales']}
    with pytest.raises(HTTPException, match='Only people who approve sales'):
        call(live, 'editor', lambda s, a: decide(s, a, edited.request_key, OfflineDecision(decision='post')))
    cash = balance(live, '1000')
    assert call(live, 'owner', lambda s, a: decide(s, a, edited.request_key, OfflineDecision(decision='post', note='Agreed price')))['status'] == 'posted'
    assert balance(live, '1000') - cash == Decimal('60000')
    with pytest.raises(HTTPException, match='Say why'):
        call(live, 'owner', lambda s, a: decide(s, a, old.request_key, OfflineDecision(decision='discard')))
    assert call(live, 'owner', lambda s, a: decide(s, a, old.request_key, OfflineDecision(decision='discard', note='Recorded on paper already')))['status'] == 'discarded'
    with pytest.raises(HTTPException, match='already been decided'):
        call(live, 'owner', lambda s, a: decide(s, a, old.request_key, OfflineDecision(decision='post')))
    assert [s['reason'] for s in call(live, 'owner', lambda s, a: review_list(s, a))['sales']] == ['discount']
    books_balance(live)
