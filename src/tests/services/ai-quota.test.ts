import { AI_NOT_ON_PLAN, allowanceLine, limitReachedLine } from '@/lib/ai-quota';

const oga = { billed: true, limit: 100, used: 63, remaining: 37, resets_at: '2026-11-30T23:00:00Z' };

test('the allowance reads as questions left this month, with the Lagos reset date', () => {
  expect(allowanceLine(oga)).toBe('37 of 100 AI questions left this month. Resets on 1 Dec 2026.');
  expect(allowanceLine({ ...oga, limit: 0, remaining: 0 })).toBe(AI_NOT_ON_PLAN);
  expect([allowanceLine({ ...oga, billed: false, limit: null }), allowanceLine({ ...oga, limit: null }), allowanceLine(true), allowanceLine(null)])
    .toEqual([null, null, null, null]);
});

test('at the limit the refusal shows zero remaining and when it resets (TEST-210)', () => {
  expect(limitReachedLine({ ...oga, used: 100, remaining: 0 }))
    .toBe("You've used all 100 AI questions on your plan this month (0 left). They reset on 1 Dec 2026. Upgrade in Billing for more.");
  expect(limitReachedLine({ ...oga, limit: 0, remaining: 0 })).toBe(AI_NOT_ON_PLAN);
  expect(limitReachedLine(null)).toContain('(0 left)');
});
