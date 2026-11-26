"""Funding readiness scoring (Doc 15 "Funding readiness scoring"): linear measures between fixed thresholds, a dimension
as the average of its measures, weights shared out when a dimension cannot be worked out, D6's no-debt rule and the
bands. Pure functions: no database."""
import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path
import pytest
from fastapi import HTTPException
from cacu.accounting.readiness import BANDS, DIMENSIONS, MEASURES, NOTICE, band, period, scale, score

SEED = Path(__file__).resolve().parents[2] / 'supabase/migrations/20261129090000_funding_readiness.sql'
MODEL = json.loads(re.search(r"VALUES \('fra-1', '(.*?)'::jsonb\)", SEED.read_text(encoding='utf-8'), re.S).group(1))

BEST = {'days_recorded': 96, 'open_exceptions': 0, 'revenue_cv': '0.1', 'revenue_growth': 20, 'net_margin': 18, 'profitable_months': 100,
        'positive_cash_months': 90, 'cash_cover_days': 45, 'debt_cover': '2.5', 'overdue_60_share': 5, 'top_customer_share': 15}


def test_the_model_has_doc_15_weights_and_every_measure():
    assert MODEL['weights'] == {'D1': 20, 'D2': 15, 'D3': 10, 'D4': 20, 'D5': 15, 'D6': 10, 'D7': 10}
    assert sum(MODEL['weights'].values()) == 100
    assert set(MODEL['measures']) == set(MEASURES) == {m for _, _, ms in DIMENSIONS for m in ms}
    assert [b['band'] for b in MODEL['bands']] == list(BANDS)
    assert (MODEL['period_months'], MODEL['eligibility']) == (12, {'full_months': 6, 'exception_age_days': 30})


def test_a_measure_is_a_clipped_straight_line_in_either_direction():
    assert scale(Decimal('67.5'), Decimal('95'), Decimal('40')) == 50
    assert scale(Decimal('99'), Decimal('95'), Decimal('40')) == 100 and scale(Decimal('10'), Decimal('95'), Decimal('40')) == 0
    assert scale(Decimal('0.475'), Decimal('0.15'), Decimal('0.80')) == 50  # lower is better for revenue variation
    with pytest.raises(ValueError):
        scale(Decimal('1'), Decimal('2'), Decimal('2'))


def test_the_best_figures_score_100_and_every_point_is_explained():
    result = score({k: Decimal(str(v)) for k, v in BEST.items()}, MODEL)
    assert (result['score'], result['band'], result['based_on']) == (100, 'strong', 7)
    for d in result['dimensions']:
        assert d['score'] == 100 and d['share'] == format(Decimal(d['weight']), '.1f')
        for m in d['measures']:
            assert {'label', 'value', 'unit', 'best', 'worst', 'score'} <= set(m)


def test_a_dimension_is_the_average_of_its_measures_and_the_total_is_weighted():
    figures = {**{k: Decimal(str(v)) for k, v in BEST.items()}, 'days_recorded': Decimal('67.5'), 'open_exceptions': Decimal('10')}
    result = score(figures, MODEL)
    d1 = next(d for d in result['dimensions'] if d['key'] == 'D1')
    assert [m['score'] for m in d1['measures']] == [50, 0] and d1['score'] == 25
    assert result['score'] == 85  # 25 × 20% + 100 × 80%


def test_a_dimension_that_cannot_be_worked_out_shares_its_weight_and_says_so():
    figures = {k: Decimal(str(v)) for k, v in BEST.items()}
    figures.update(revenue_growth=None, overdue_60_share=Decimal('30'), top_customer_share=Decimal('45'))  # D7 = 50
    result = score(figures, MODEL)
    d3 = next(d for d in result['dimensions'] if d['key'] == 'D3')
    assert d3['score'] is None and d3['share'] is None and d3['measures'][0]['note'] == 'Not enough in the books to work this out.'
    assert result['based_on'] == 6
    assert result['score'] == 94  # (80 × 100 + 10 × 50) / 90
    with pytest.raises(HTTPException):
        score({}, MODEL)


def test_no_debt_follows_the_stated_rule():
    figures = {k: Decimal(str(v)) for k, v in BEST.items()} | {'debt_cover': None, 'no_debt': True}
    d6 = lambda f: next(d for d in score(f, MODEL)['dimensions'] if d['key'] == 'D6')
    assert d6({**figures, 'average_operating_cash': Decimal('5000')})['score'] == 100
    losing = d6({**figures, 'average_operating_cash': Decimal('-1')})
    assert losing['score'] == 0 and 'did not bring cash in' in losing['measures'][0]['note']
    assert d6({**figures, 'no_debt': False, 'average_operating_cash': None})['score'] is None


def test_bands_and_their_words_never_promise_a_loan():
    assert [band(s, MODEL) for s in (100, 80, 79, 60, 59, 40, 39, 0)] == ['strong', 'strong', 'developing', 'developing', 'early', 'early', 'not_yet_ready', 'not_yet_ready']
    for label, text in BANDS.values():
        assert not re.search(r'\b(loan|approved|qualif|will get|guarantee)', text, re.I)
    assert 'not a credit rating' in NOTICE


def test_the_period_is_the_full_months_since_the_books_began_up_to_twelve():
    assert period(date(2026, 3, 15), date(2026, 11, 25), MODEL) == (date(2026, 4, 1), date(2026, 10, 31), 7)
    assert period(date(2026, 3, 1), date(2026, 11, 25), MODEL) == (date(2026, 3, 1), date(2026, 10, 31), 8)
    assert period(date(2024, 6, 10), date(2026, 1, 5), MODEL) == (date(2025, 1, 1), date(2025, 12, 31), 12)
    assert period(date(2026, 11, 2), date(2026, 11, 25), MODEL)[2] == 0
