import fixture from './cash-flow-fixture.json';
export async function getCashFlowAction(start: string, end: string) {
  while ((window as Window & { __holdCashFlow?: boolean }).__holdCashFlow) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  if (start === '2020-01-01') return { success: false as const, error: 'Accounting unavailable' };
  return { success: true as const, data: { ...fixture, start_date: start, end_date: end } };
}
