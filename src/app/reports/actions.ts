
'use server';

import { ReportService } from '@/services/report-service';

export async function getProfitAndLossAction(startDate: string, endDate: string) {
  try {
    const service = new ReportService();
    const data = await service.getProfitAndLoss(startDate, endDate);
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getBalanceSheetAction() {
  try {
    const service = new ReportService();
    const data = await service.getBalanceSheet();
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
