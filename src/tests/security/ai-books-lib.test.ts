import { canonical, checkFigures, inert, sourcesAndLimits, type ToolResult } from '@/lib/ai-books';

const result = (over: Partial<ToolResult> = {}): ToolResult => ({ tool: 'receivables', period: { as_of: '2026-11-18' }, source: { screen: 'Ageing', path: '/analytics/aging-reports' },
  data: { customers: [{ customer: 'Ada', owes: '125000.00', overdue_over_60_days: '0.00' }, { customer: 'Bisi', owes: '4500.50' }], customer_count: 2 },
  limitations: [], label: 'From your CACU books, not reviewed', ...over });

test('figures compare in canonical form', () => {
  expect(['₦125,000.00', '125000', 'N125,000', '125000.0'].map(canonical)).toEqual(['125000', '125000', '125000', '125000']);
  expect(canonical('−₦500.50')).toBe('-500.5');
  expect(canonical('23%')).toBe('23');
  expect(canonical('abc')).toBeNull();
});

test('AI-001: figures from the tools pass, made-up ones are flagged, with counts and dates allowed from the results', () => {
  const r = [result()];
  expect(checkFigures('Ada owes ₦125,000.00 and Bisi owes ₦4,500.50 at 18 November 2026. 2 customers owe you.', r)).toEqual({ status: 'passed', unchecked: [] });
  expect(checkFigures('Nobody is more than 60 days overdue.', r).status).toBe('passed');  // from the field name
  expect(checkFigures('In total ₦129,500.50 is owed.', r)).toEqual({ status: 'flagged', unchecked: ['₦129,500.50'] });  // a sum the model made
  expect(checkFigures('Ada owes about ₦130k.', r).status).toBe('flagged');
  expect(checkFigures('Nobody owes you anything.', r)).toEqual({ status: 'none', unchecked: [] });
  expect(checkFigures('You asked about the last 45 days.', r, 'Who has owed me for 45 days?').status).toBe('passed');
  expect(checkFigures('A loss of ₦500.00.', [result({ data: { net: '-500.00' } })]).status).toBe('passed');
});

test('AI-007: markup, control and invisible characters are removed', () => {
  expect(inert('<img src=x onerror=alert(1)>Hi\u0007 there‮​!')).toBe('Hi there !');
  expect(inert('line one\nline two')).toBe('line one\nline two');
  expect(inert('x'.repeat(50), 10)).toHaveLength(10);
});

test('AI-002/003: sources and limitations come from the tool results, and unsafe links are dropped', () => {
  const out = sourcesAndLimits([result({ limitations: ['1 transfer waiting.'] }), result({ limitations: ['1 transfer waiting.'] }),
    result({ source: { screen: 'Evil', path: 'https://example.com' } }),
    result({ tool: 'profit_summary', period: { start_date: '2026-11-01', end_date: '2026-11-18' }, source: { screen: 'Reports', path: '/reports' } })]);
  expect(out.sources).toEqual([{ screen: 'Ageing', path: '/analytics/aging-reports', period: 'at 2026-11-18' }, { screen: 'Reports', path: '/reports', period: '2026-11-01 to 2026-11-18' }]);
  expect(out.limitations).toEqual(['1 transfer waiting.']);
});
