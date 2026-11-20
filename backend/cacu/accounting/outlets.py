"""Purchasing, part 4a: stock per outlet (Doc 10; owner decisions of 7 November 2026).

A product's total and its weighted-average cost stay on the product; once a business has outlets the database keeps the
total split by outlet (accounting.outlet_stock). The runtime names the outlet each action moves stock at with the
transaction setting cacu.outlet: a till sale uses the seller's shift outlet (or the outlet they are assigned to), goods
are received into a chosen outlet, a supplier return leaves from the receipt's outlet, a refund goes back to the outlet
the sale came from. Without a name the database uses the main outlet (the earliest open one)."""
from uuid import UUID
from fastapi import HTTPException
from cacu.accounting.posting import raw


def _present(session):
    return bool(raw(session, "SELECT to_regclass('public.business_locations') IS NOT NULL").scalar())


def listed(session, include_closed=False):
    """The business's outlets, main one first."""
    if not _present(session): return []
    rows = raw(session, f"""SELECT id,name,is_active FROM public.business_locations WHERE business_id=%s{'' if include_closed else ' AND is_active'}
      ORDER BY is_active DESC,created_at,id""", (str(session.business_id),)).all()
    return [{'id': str(r.id), 'name': r.name, 'is_active': r.is_active} for r in rows]


def assigned(session, actor):
    """The outlet a member is restricted to, or None when they work at all outlets."""
    if not _present(session): return None
    row = raw(session, """SELECT (to_jsonb(m)->>'all_locations')::boolean AS everywhere,(to_jsonb(m)->>'location_id')::uuid AS location_id
      FROM public.memberships m WHERE m.business_id=%s AND m.user_id=%s""", (str(session.business_id), str(actor))).first()
    if not row or row.everywhere is not False or row.location_id is None: return None
    return str(row.location_id)


def name(session, location_id):
    if location_id is None or not _present(session): return None
    return raw(session, 'SELECT name FROM public.business_locations WHERE business_id=%s AND id=%s',
               (str(session.business_id), str(location_id))).scalar()


def choose(session, actor, requested: UUID | None, missing: str):
    """The outlet for an action: the member's own outlet if they are restricted to one, else the one asked for (an open
    outlet of this business), else the only open outlet. None when the business has no outlets."""
    open_outlets = listed(session)
    if not open_outlets:
        if requested is not None: raise HTTPException(422, 'This business has no outlets yet. Add them in Users, under Branches and locations.')
        return None
    own = assigned(session, actor)
    if own is not None:
        if requested is not None and str(requested) != own:
            raise HTTPException(403, f'You work at {name(session, own) or "another outlet"}, so you can only use that outlet')
        return own
    if requested is not None:
        if str(requested) not in {o['id'] for o in open_outlets}: raise HTTPException(422, 'Choose one of your open outlets')
        return str(requested)
    if len(open_outlets) == 1: return open_outlets[0]['id']
    raise HTTPException(422, missing)


def use(session, location_id):
    """Names the outlet this transaction moves stock at (None: the main outlet)."""
    raw(session, "SELECT set_config('cacu.outlet',%s,true)", ('' if location_id is None else str(location_id),))


def current(session):
    """The outlet stock moves at now, or None when the business has no outlets."""
    if not _present(session): return None
    found = raw(session, 'SELECT accounting.current_outlet(%s)', (str(session.business_id),)).scalar()
    return str(found) if found else None


def held(session, item_id, location_id):
    """How many of a product an outlet holds."""
    return raw(session, 'SELECT coalesce((SELECT quantity FROM accounting.outlet_stock WHERE business_id=%s AND location_id=%s AND item_id=%s),0)',
               (str(session.business_id), str(location_id), str(item_id))).scalar()


def selling(session, actor):
    """Where a person's sale or job takes stock from: their open shift's outlet, else the outlet they are assigned to,
    else the main outlet."""
    from cacu.accounting.shifts import open_shift
    shift = open_shift(session, actor)
    if shift is not None and getattr(shift, 'location_id', None): return str(shift.location_id)
    return assigned(session, actor)


def short(session, item_id, wanted):
    """At the current outlet: (held, outlet name) when it holds fewer than wanted while the business holds more; else None."""
    outlet = current(session)
    if outlet is None: return None
    have = held(session, item_id, outlet)
    return (max(have, 0), name(session, outlet)) if have < wanted else None


def stock(session):
    """Stock by outlet for every tracked, active product."""
    outlets = listed(session, include_closed=True)
    rows = raw(session, """SELECT c.id,c.name,c.stock_quantity,coalesce(jsonb_object_agg(s.location_id,s.quantity) FILTER (WHERE s.location_id IS NOT NULL),'{}') AS held
      FROM public.catalog_items c LEFT JOIN accounting.outlet_stock s ON s.business_id=c.business_id AND s.item_id=c.id
      WHERE c.business_id=%s AND c.item_type='PRODUCT' AND coalesce((to_jsonb(c)->>'track_stock')::boolean,true) AND c.is_active
      GROUP BY c.id,c.name,c.stock_quantity ORDER BY c.name LIMIT 1000""", (str(session.business_id),)).all()
    shown = [o for o in outlets if o['is_active'] or any((r.held or {}).get(o['id']) for r in rows)]
    items = []
    for r in rows:
        held_by = {o['id']: int((r.held or {}).get(o['id'], 0)) for o in shown}
        items.append({'id': str(r.id), 'name': r.name, 'total': r.stock_quantity or 0, 'outlets': held_by,
                      'in_transit': (r.stock_quantity or 0) - sum(int(v) for v in (r.held or {}).values()) if outlets else 0})
    return {'outlets': shown, 'items': items}
