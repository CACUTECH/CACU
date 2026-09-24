
'use server';

import { ReportService } from '@/services/report-service';

export async function getDashboardStatsAction(startDate: string, endDate: string) {
  try {
    const service = new ReportService();
    return { success: true, data: await service.getDashboardStats(startDate, endDate) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getRevenueTrendAction(startDate: string, endDate: string, interval: any) {
  try {
    const service = new ReportService();
    return { success: true, data: await service.getRevenueTrend(startDate, endDate, interval) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

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

export async function getProductPerformanceAction() {
  try {
    const service = new ReportService();
    return { success: true, data: await service.getProductPerformance() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
