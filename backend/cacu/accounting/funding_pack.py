"""Funding readiness, part 3 (Doc 15 FRA-006..008, FR-184; E19 R3): the lender pack and consented sharing.

The pack holds the management statements for the assessed period (labelled "Management statements, not reviewed",
BR-061), the assessment with its explanation, a data-completeness note and the business profile, and nothing else
(FRA-006). It never carries customer or supplier names, the recommendations (they are the owner's own plan), or any
way into the books.

Sharing (FRA-007): the owner names who it is for and why, previews exactly what will be shared, and confirms. The
confirmation carries the preview's SHA-256, and the pack is built again and compared, so what is shared is what the
owner saw; if the books moved in between, the owner is asked to look again. The pack is then kept as a fixed snapshot
behind a link that expires (30 days unless the owner chooses, at most 90) and can be withdrawn. Lenders open the
snapshot; they never get access to the books (FRA-008). Every share and every opening is recorded (FR-184).

Only the owner can share, on the Chairman plan (module.funding = lender_pack), while funding readiness is on.
"""
import hashlib
import json
import secrets
from uuid import UUID
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from cacu.accounting.posting import raw
from cacu.accounting.readiness import LIMITATIONS, NOTICE, _available, _cutover, exceptions

PACK_VERSION = 1
DEFAULT_DAYS = 30
MAX_DAYS = 90
OWNER_MESSAGE = 'Only the business owner can share the lender pack.'
PLAN_MESSAGE = 'Sharing a lender pack comes with the Chairman plan.'
CHANGED_MESSAGE = 'Your books changed after you looked at the pack. Look at it again before you share it.'


class ShareDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assessment_id: UUID | None = None
    recipient_name: str = Field(min_length=2, max_length=120)
    recipient_organisation: str | None = Field(default=None, max_length=120)
    purpose: str = Field(min_length=3, max_length=300)
    expires_in_days: int = Field(default=DEFAULT_DAYS, ge=1, le=MAX_DAYS)

    @field_validator('recipient_name', 'purpose', 'recipient_organisation')
    @classmethod
    def _trimmed(cls, value):
        if value is None:
            return None
        value = ' '.join(value.split())
        return value or None


class ShareCreate(ShareDraft):
    request_key: UUID
    pack_sha256: str = Field(pattern='^[0-9a-f]{64}$')


def _allowed(session, actor) -> None:
    state = _available(session)
    if not state['available']:
        raise HTTPException(409, state['message'])
    if state['level'] != 'lender_pack':
        raise HTTPException(403, PLAN_MESSAGE)
    role = raw(session, 'SELECT accounting.lock_membership(%s, %s)', (str(session.business_id), str(actor))).scalar()
    if role != 'owner':
        raise HTTPException(403, OWNER_MESSAGE)


def _without_ids(value):
    """Drops the books' internal account ids: the lender reads codes and names."""
    if isinstance(value, dict):
        return {k: _without_ids(v) for k, v in value.items() if k not in {'account_id', 'business_id', 'generated_at'}}
    if isinstance(value, list):
        return [_without_ids(v) for v in value]
    return value


def _assessment(session, assessment_id):
    if assessment_id is None:
        row = raw(session, 'SELECT * FROM accounting.funding_assessment WHERE business_id=%s ORDER BY created_at DESC LIMIT 1',
                  (str(session.business_id),)).first()
        if row is None:
            raise HTTPException(409, 'Work out an assessment before you share a pack.')
        return row
    row = raw(session, 'SELECT * FROM accounting.funding_assessment WHERE business_id=%s AND id=%s',
              (str(session.business_id), str(assessment_id))).first()
    if row is None:
        raise HTTPException(404, 'Assessment not found')
    return row


def build_pack(session, row) -> dict:
    """The pack for one assessment, from the books as they stand today (FRA-006). The same books give the same pack."""
    from cacu.accounting.reports import LABELS, cash_flow, statements
    from cacu.accounting.workflows import business_today
    result = row.result
    start, end = row.period_start, row.period_end
    books = statements(session, start, end)
    try:
        flow = cash_flow(session, start, end)
        cash = {'sections': [{'key': s['key'], 'lines': [{'label': l['label'], 'amount': l['amount']} for l in s['lines']], 'total': s['total']}
                             for s in flow['sections']],
                'opening_cash': flow['opening_cash'], 'net_change': flow['net_change'], 'closing_cash': flow['closing_cash'],
                'reconciled': flow['reconciled'], 'note': None}
    except HTTPException:
        cash = {'sections': [], 'opening_cash': None, 'net_change': None, 'closing_cash': None, 'reconciled': None,
                'note': 'The cash-flow statement is not included: some accounts still need their cash-flow mapping reviewed.'}
    profile = raw(session, 'SELECT accounting.funding_profile(%s)', (str(session.business_id),)).scalar() or {}
    cutover = _cutover(session)
    dimensions = [{k: v for k, v in d.items() if k != 'recommendations'} for d in result['dimensions']]
    not_worked_out = [m['label'] for d in result['dimensions'] for m in d['measures'] if m['value'] is None and m['score'] is None]
    days = next((m['value'] for d in result['dimensions'] for m in d['measures'] if m['key'] == 'days_recorded'), None)
    today = business_today(session)
    open_now = exceptions(session, today)['total']
    return {
        'kind': 'cacu_funding_pack', 'version': PACK_VERSION, 'notice': NOTICE, 'label': 'From CACU books, not reviewed',
        'prepared_on': today.isoformat(),
        'business': {'name': profile.get('name'), 'business_type': profile.get('business_type'), 'address': profile.get('address'),
                     'books_started': cutover.isoformat() if cutover else None},
        'period': result['period'],
        'statements': {'tier': LABELS['tier'], 'basis': LABELS['basis'], 'currency': LABELS['currency'],
                       'income_statement': _without_ids(books['income_statement']),
                       'financial_position': _without_ids(books['financial_position']),
                       'changes_in_equity': _without_ids(books['changes_in_equity']),
                       'cash_flow': cash, 'checks': [e['message'] for e in books['exceptions']]},
        'assessment': {'assessed_on': row.assessed_on.isoformat(), 'kind': row.kind, 'model_version': row.model_version,
                       'score': result['score'], 'band': result['band'], 'band_label': result['band_label'], 'band_text': result['band_text'],
                       'based_on': result['based_on'], 'dimensions': dimensions, 'information': result.get('information', {})},
        'completeness': {
            'months': result['period']['months'], 'dimensions_used': result['based_on'], 'dimensions_total': 7,
            'trading_days_recorded': days, 'open_exceptions_when_prepared': open_now,
            'not_worked_out': not_worked_out,
            'notes': ['Figures are the business\'s own records in CACU; no accountant has reviewed them.',
                      'The statements are prepared from the books on the date above; the assessment on the date it was made.',
                      *LIMITATIONS],
        },
    }


def pack_hash(pack: dict) -> str:
    return hashlib.sha256(json.dumps(pack, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()


def preview(session, actor, draft: ShareDraft) -> dict:
    """Exactly what would be shared, and with whom, before the owner confirms (FRA-007)."""
    _allowed(session, actor)
    pack = build_pack(session, _assessment(session, draft.assessment_id))
    return {'recipient_name': draft.recipient_name, 'recipient_organisation': draft.recipient_organisation, 'purpose': draft.purpose,
            'expires_in_days': draft.expires_in_days, 'pack': pack, 'pack_sha256': pack_hash(pack)}


def _share(row, opens=None) -> dict:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    status = 'withdrawn' if row.withdrawn_at else 'expired' if row.expires_at <= now else 'live'
    out = {'id': str(row.id), 'assessment_id': str(row.assessment_id), 'recipient_name': row.recipient_name,
           'recipient_organisation': row.recipient_organisation, 'purpose': row.purpose, 'created_at': row.created_at.isoformat(),
           'expires_at': row.expires_at.isoformat(), 'withdrawn_at': row.withdrawn_at.isoformat() if row.withdrawn_at else None,
           'status': status, 'pack_sha256': row.pack_sha256}
    if opens is not None:
        out['openings'] = [{'opened_at': o.opened_at.isoformat(), 'outcome': o.outcome} for o in opens]
        out['times_opened'] = sum(1 for o in opens if o.outcome == 'opened')
    return out


def share(session, actor, request: ShareCreate) -> dict:
    """Confirms a share: the pack is built again, and must match the one the owner looked at. Returns the link's token
    once; CACU keeps only its hash, so a lost link is withdrawn and shared again."""
    _allowed(session, actor)
    existing = raw(session, 'SELECT * FROM accounting.funding_share WHERE business_id=%s AND request_key=%s',
                   (str(session.business_id), str(request.request_key))).first()
    if existing is not None:  # a retried confirmation: the link was made, and its token cannot be shown again
        return {**_share(existing), 'token': None}
    row = _assessment(session, request.assessment_id)
    pack = build_pack(session, row)
    digest = pack_hash(pack)
    if digest != request.pack_sha256:
        raise HTTPException(409, CHANGED_MESSAGE)
    token = secrets.token_hex(32)
    made = raw(session, """INSERT INTO accounting.funding_share(business_id, assessment_id, request_key, recipient_name, recipient_organisation,
          purpose, pack, pack_sha256, token_sha256, expires_at, created_by)
        VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s, now() + make_interval(days => %s), %s) RETURNING *""",
               (str(session.business_id), str(row.id), str(request.request_key), request.recipient_name, request.recipient_organisation,
                request.purpose, json.dumps(pack, ensure_ascii=False), digest, hashlib.sha256(token.encode()).hexdigest(),
                request.expires_in_days, str(actor))).first()
    return {**_share(made, []), 'token': token}


def list_shares(session, actor) -> list[dict]:
    """Every pack shared, newest first, with each time its link was opened (FR-184)."""
    _allowed(session, actor)
    rows = raw(session, 'SELECT * FROM accounting.funding_share WHERE business_id=%s ORDER BY created_at DESC LIMIT 100',
               (str(session.business_id),)).all()
    opens = {}
    for o in raw(session, """SELECT share_id, opened_at, outcome FROM accounting.funding_share_access WHERE business_id=%s
            ORDER BY opened_at DESC""", (str(session.business_id),)).all():
        opens.setdefault(o.share_id, []).append(o)
    return [_share(r, opens.get(r.id, [])) for r in rows]


def withdraw(session, actor, share_id) -> dict:
    """Stops the link working straight away. Withdrawing twice changes nothing."""
    _allowed(session, actor)
    row = raw(session, 'SELECT * FROM accounting.funding_share WHERE business_id=%s AND id=%s', (str(session.business_id), str(share_id))).first()
    if row is None:
        raise HTTPException(404, 'Shared pack not found')
    if row.withdrawn_at is None:
        row = raw(session, """UPDATE accounting.funding_share SET withdrawn_at=now(), withdrawn_by=%s
            WHERE business_id=%s AND id=%s AND withdrawn_at IS NULL RETURNING *""", (str(actor), str(session.business_id), str(share_id))).first()
    opens = raw(session, 'SELECT opened_at, outcome FROM accounting.funding_share_access WHERE business_id=%s AND share_id=%s ORDER BY opened_at DESC',
                (str(session.business_id), str(share_id))).all()
    return _share(row, opens)

