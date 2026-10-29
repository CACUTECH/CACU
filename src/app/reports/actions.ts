
'use server';

import { ReportService } from '@/services/report-service';

export async function getDashboardStatsAction(startDate: string, endDate: string) {
  try {
    const service = new ReportService();
    return { success: true, data: await service.getDashboardStats(startDate, endDate) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Report unavailable' };
  }
}

export async function getRevenueTrendAction(startDate: string, endDate: string, interval: 'day' | 'week' | 'month') {
  try {
    const service = new ReportService();
    return { success: true, data: await service.getRevenueTrend(startDate, endDate, interval) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Report unavailable' };
  }
}

export async function getProfitAndLossAction(startDate: string, endDate: string) {
  try {
    const service = new ReportService();
    const data = await service.getProfitAndLoss(startDate, endDate);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Report unavailable' };
  }
}

export async function getBalanceSheetAction() {
  try {
    const service = new ReportService();
    const data = await service.getBalanceSheet();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Report unavailable' };
  }
}

export async function getProductPerformanceAction() {
  try {
    const service = new ReportService();
    return { success: true, data: await service.getProductPerformance() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Report unavailable' };
  }
}

export async function getAccountingSummaryAction(start: string, end: string) {
  try {
    const { getAccountingSummary } = await import('@/lib/accounting-client');
    return { success: true as const, data: await getAccountingSummary(start, end) };
  } catch (error) { return { success: false as const, error: error instanceof Error ? error.message : 'Accounting report unavailable' }; }
}
