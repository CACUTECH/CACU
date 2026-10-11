export async function getProfitAndLossAction() {
  return { success: true, data: { income: '60000.00', expenses: '35000.00', netProfit: '25000.00', categories: {} } };
}
export async function getBalanceSheetAction() {
  return { success: false, error: 'Balance sheet unavailable for this business.' };
}
