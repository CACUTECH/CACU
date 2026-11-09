'use server';
// Full data export (Doc 10 E22 part 2): ask for one, and see recent ones. The file itself comes from /api/exports/{id}.
import { AccountingRequestError, accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
import type { DataExport } from '@/lib/data-export';

type Result<T> = { success: true; data: T } | { success: false; error: string };
const OFF = 'Turn on your books to export. The export comes from the books CACU keeps.';
const failed = (error: unknown, fallback: string): { success: false; error: string } =>
  ({ success: false, error: error instanceof AccountingRequestError && error.status < 500 ? error.message : fallback });

export async function exportsAction(): Promise<Result<DataExport[]>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF };
    return { success: true, data: await accountingRequest<DataExport[]>('exports') };
  } catch (error) { return failed(error, 'Exports are unavailable. Try again.'); }
}

export async function requestExportAction(requestKey: string): Promise<Result<DataExport>> {
  try {
    if (!(await usesPythonAccounting())) return { success: false, error: OFF };
    return { success: true, data: await accountingRequest<DataExport>('exports', { method: 'POST', body: { request_key: requestKey } }) };
  } catch (error) { return failed(error, 'The export was not started. Try again.'); }
}
