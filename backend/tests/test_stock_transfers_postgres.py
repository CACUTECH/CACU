"""Purchasing, part 4b (Doc 10; owner decision of 7 November 2026): goods sent from one outlet are in transit until the
other outlet confirms what arrived. Sending and receiving do not change the total or the books; what did not arrive is a
loss with a reason, taken out at the product's cost (Dr Stock adjustments and write-offs, Cr Inventory)."""
from decimal import Decimal
from uuid import uuid4
import pytest
from fastapi import HTTPException
from cacu.accounting.outlets import stock as by_outlet
from cacu.accounting.stock_transfers import TransferReceive, TransferSend, list_transfers, receive, send
from test_corrections_postgres import live, call, balance, stock, URL  # noqa: F401  (fixtures)
from test_opening_position_postgres import books  # noqa: F401
from test_default_chart_postgres import charted  # noqa: F401
from test_legacy_write_boundary_postgres import boundary  # noqa: F401
from test_management_postgres import managed, database  # noqa: F401
from test_pos_refunds_postgres import books_balance
from test_pos_shifts_postgres import on_plan
from test_outlet_stock_postgres import adds_up, assign, outlet, split

pytestmark = pytest.mark.skipif(not URL, reason='Disposable PostgreSQL required')


def sent(live, source, target, lines, who='owner', key=None, note=''):
    data = TransferSend(request_key=key or uuid4(), from_location=source, to_location=target, note=note,
                        lines=[{'item_id': live.items[n], 'quantity': q} for n, q in lines])
    return call(live, who, lambda s, a: send(s, a, data)), data


def arrived(live, transfer, lines, who='owner', note=''):
    data = TransferReceive(request_key=uuid4(), note=note, lines=[{'item_id': live.items[n], 'received_quantity': q} for n, q in lines])
    return call(live, who, lambda s, a: receive(s, a, transfer['id'], data)), data


def test_goods_sent_between_outlets_are_in_transit_until_received_and_a_shortfall_is_a_loss(live):
    rice = stock(live, 'Rice')[0]
    ikeja = outlet(live, 'Ikeja shop'); yaba = outlet(live, 'Yaba shop')
    stock_value, losses = balance(live, '1200'), balance(live, '5100')
    with pytest.raises(HTTPException, match=f'Only {rice} x Rice at Ikeja shop'):
        sent(live, ikeja, yaba, [('Rice', rice + 1)])
    with pytest.raises(HTTPException, match='different outlet'):
        sent(live, ikeja, ikeja, [('Rice', 1)])
    transfer, data = sent(live, ikeja, yaba, [('Rice', 5)], note='Weekend stock')
    assert (transfer['number'], transfer['status'], transfer['from_name'], transfer['to_name']) == ('TR-0001', 'in_transit', 'Ikeja shop', 'Yaba shop')
    assert call(live, 'owner', lambda s, a: send(s, a, data)) == transfer  # a retry sends once
    assert split(live, 'Rice') == {ikeja: rice - 5} and stock(live, 'Rice')[0] == rice
    rice_row = next(i for i in call(live, 'viewer', lambda s, a: by_outlet(s))['items'] if i['name'] == 'Rice')
    assert (rice_row['in_transit'], rice_row['total']) == (5, rice)
    assert balance(live, '1200') == stock_value  # nothing posted while in transit

    with pytest.raises(HTTPException, match='Say why some goods did not arrive'):
        arrived(live, transfer, [('Rice', 4)])
    with pytest.raises(HTTPException, match='Only 5 of that product were sent'):
        arrived(live, transfer, [('Rice', 6)])
    assign(live, 'admin', ikeja)
    with pytest.raises(HTTPException, match='Only someone at Yaba shop can receive this transfer'):
        arrived(live, transfer, [('Rice', 5)], who='admin')
    done, _ = arrived(live, transfer, [('Rice', 4)], note='One bag torn on the bus')
    assert (done['status'], done['loss_value'], done['lines'][0]['lost_quantity']) == ('received', '50000.00', 1)
    assert split(live, 'Rice') == {ikeja: rice - 5, yaba: 4} and stock(live, 'Rice')[0] == rice - 1
    assert balance(live, '1200') - stock_value == Decimal('-50000') and balance(live, '5100') - losses == Decimal('50000')
    with pytest.raises(HTTPException, match='already been received'):
        arrived(live, transfer, [('Rice', 4)], note='Again')
    assert [t['number'] for t in call(live, 'viewer', lambda s, a: list_transfers(s, 'received'))] == ['TR-0001']
    adds_up(live)  # nothing left in transit
    books_balance(live)


def test_people_tied_to_an_outlet_send_only_from_it_and_transfers_need_purchasing(live):
    ikeja = outlet(live, 'Ikeja shop'); yaba = outlet(live, 'Yaba shop')
    assign(live, 'admin', yaba)
    with pytest.raises(HTTPException, match='You work at Yaba shop'):
        sent(live, ikeja, yaba, [('Rice', 1)], who='admin')
    transfer, _ = sent(live, ikeja, yaba, [('Rice', 2)])
    assert arrived(live, transfer, [('Rice', 2)], who='admin')[0]['loss_value'] == '0.00'  # all arrived: nothing posted
    with pytest.raises(HTTPException, match='Choose two of your outlets'):
        sent(live, ikeja, str(uuid4()), [('Rice', 1)])
    on_plan(live, 'BASE')
    with pytest.raises(HTTPException, match='Oga and Chairman plans'):
        sent(live, ikeja, yaba, [('Rice', 1)])
    adds_up(live)
