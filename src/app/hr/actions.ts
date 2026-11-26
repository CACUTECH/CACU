'use server';

import { revalidatePath } from 'next/cache';
import { HRError, HRService } from '@/services/hr-service';
import type { HRMutation, HRResult } from '@/lib/hr';
import type { RemittanceDetails } from '@/lib/remittances';
import type { SharedPayslip } from '@/lib/payslips';

export async function mutateHRAction(input: HRMutation): Promise<HRResult> {
  try {
    const data = await new HRService().write(input);
    revalidatePath('/hr', 'layout');
    return { success: true, data };
  } catch (error) {
    if (error instanceof HRError) return { success: false, error: error.message, uncertain: error.uncertain };
    return { success: false, error: 'The HR change was not confirmed. Retry to check whether it was applied.', uncertain: true };
  }
}

/** An employee's tax state and PFA for the remittance schedules (E21 R4). */
export async function saveRemittanceDetailsAction(employeeId: string, details: RemittanceDetails):
  Promise<{ success: true; data: RemittanceDetails } | { success: false; error: string }> {
  try {
    const data = await new HRService().saveRemittanceDetails(employeeId, details);
    revalidatePath('/hr', 'layout');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof HRError ? error.message : 'The remittance details were not saved. Try again.' };
  }
}

/** Shares one approved payslip with its employee by a link (E21 R4). The token comes back once, to show the sharer. */
export async function sharePayslipAction(payslipId: string, days: number):
  Promise<{ success: true; data: SharedPayslip } | { success: false; error: string }> {
  try {
    const data = await new HRService().sharePayslip(payslipId, days);
    revalidatePath('/hr', 'layout');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof HRError ? error.message : 'The payslip link was not made. Try again.' };
  }
}

export async function withdrawPayslipLinkAction(payslipId: string): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await new HRService().withdrawPayslipLink(payslipId);
    revalidatePath('/hr', 'layout');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof HRError ? error.message : 'The payslip link was not withdrawn. Try again.' };
  }
}
