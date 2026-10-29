import { BaseService } from './base-service';
import { EMPLOYEE_COLUMNS, HR_OPERATIONS, UUID_PATTERN, hrErrorMessage, isIsoDate,
  type EmployeeRecord, type HistoryEntry, type HRMutation, type PayrollRules } from '@/lib/hr';

/** Messages from this error are reviewed and safe to show in the browser. */
export class HRError extends Error {
  constructor(message: string, public readonly uncertain = false) { super(message); this.name = 'HRError'; }
}

/**
 * @fileOverview HRService reads workforce data and sends every change through the audited hr_write command.
 * Reads rely on Owner/Admin row-level security and repeat the role check before any query.
 */
export class HRService extends BaseService {
  private async managerContext() {
    const context = await this.getContext();
    if (!context.businessId || (context.role !== 'owner' && context.role !== 'admin')) {
      throw new HRError('HR access is restricted to owners and administrators');
    }
    return context as typeof context & { businessId: string };
  }

  /** Personnel directory deliberately excludes salary and bank details. */
  async listEmployeeDirectory(page = 0) {
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000) {
      throw new Error('Invalid employee page');
    }
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId || (role !== 'owner' && role !== 'admin')) {
      throw new Error('HR access is restricted to owners and administrators');
    }
    const { data, error, count } = await supabase.from('employees')
      .select('id,full_name,job_title,department,employment_status', { count: 'exact' })
      .eq('business_id', businessId)
      .order('full_name', { ascending: true }).order('id', { ascending: true })
      .range(page * 20, page * 20 + 19);
    if (error || data === null || count === null) throw new Error('Employee records unavailable');
    return { data, total: count };
  }

  async getEmployee(id: string) {
    if (!UUID_PATTERN.test(id)) return null;
    const { supabase, businessId } = await this.managerContext();
    const { data, error } = await supabase.from('employees').select(EMPLOYEE_COLUMNS)
      .eq('business_id', businessId).eq('id', id).maybeSingle();
    if (error) throw new HRError('Employee record unavailable');
    return data as EmployeeRecord | null;
  }

  async history(recordId: string) {
    if (!UUID_PATTERN.test(recordId)) return [];
    const { supabase, businessId } = await this.managerContext();
    const { data, error } = await supabase.rpc('hr_history', { p_business_id: businessId, p_record_id: recordId });
    if (error || !Array.isArray(data)) throw new HRError('Change history unavailable');
    return data as HistoryEntry[];
  }

  /** Active, on-leave and suspended staff with each one's open shift and the selected day's records. */
  async attendanceDay(day: string) {
    if (!isIsoDate(day)) throw new HRError('Choose a valid date');
    const { supabase, businessId } = await this.managerContext();
    const [staff, records, open] = await Promise.all([
      supabase.from('employees').select('id,full_name,job_title,employment_status').eq('business_id', businessId)
        .in('employment_status', ['active', 'on_leave', 'suspended']).order('full_name').order('id').limit(500),
      supabase.from('attendance').select('id,employee_id,check_in,check_out,note,work_date').eq('business_id', businessId)
        .eq('work_date', day).order('check_in').limit(2000),
      supabase.from('attendance').select('id,employee_id,check_in,work_date').eq('business_id', businessId).is('check_out', null).limit(500),
    ]);
    if (staff.error || records.error || open.error || !staff.data || !records.data || !open.data) throw new HRError('Attendance unavailable');
    return { staff: staff.data, records: records.data, open: open.data };
  }

  async payrollRuns() {
    const { supabase, businessId } = await this.managerContext();
    const { data, error } = await supabase.from('hr_payroll_runs')
      .select('id,period,status,employee_count,gross_total,paye_total,net_total,rules_reviewed_at,created_at,approved_at')
      .eq('business_id', businessId).order('period', { ascending: false }).order('created_at', { ascending: false }).limit(60);
    if (error || !data) throw new HRError('Payroll runs unavailable');
    return data;
  }

  async payrollRun(id: string) {
    if (!UUID_PATTERN.test(id)) return null;
    const { supabase, businessId } = await this.managerContext();
    const [run, slips] = await Promise.all([
      supabase.from('hr_payroll_runs').select('*').eq('business_id', businessId).eq('id', id).maybeSingle(),
      supabase.from('hr_payslips').select('*').eq('business_id', businessId).eq('run_id', id).order('employee_name').order('id').limit(1000),
    ]);
    if (run.error || slips.error || !slips.data) throw new HRError('Payroll run unavailable');
    return run.data ? { run: run.data, payslips: slips.data } : null;
  }

  /** Saved rules, or the statutory defaults marked unreviewed. */
  async payrollRules() {
    const { supabase, businessId } = await this.managerContext();
    const { data, error } = await supabase.from('hr_payroll_rules').select('rules,version,reviewed_at').eq('business_id', businessId).maybeSingle();
    if (error) throw new HRError('Payroll rules unavailable');
    if (data) return { rules: data.rules as PayrollRules, version: data.version as number, reviewed_at: data.reviewed_at as string };
    const defaults = await supabase.rpc('hr_payroll_defaults');
    if (defaults.error || !defaults.data) throw new HRError('Payroll rules unavailable');
    return { rules: defaults.data as PayrollRules, version: 0, reviewed_at: null };
  }

  async write(input: HRMutation) {
    if (!input || typeof input.request_key !== 'string' || !UUID_PATTERN.test(input.request_key)
      || !(HR_OPERATIONS as readonly string[]).includes(input.operation) || typeof input.details !== 'object' || input.details === null
      || (input.record_id != null && !UUID_PATTERN.test(input.record_id))
      || (input.expected_version != null && !Number.isSafeInteger(input.expected_version))) {
      throw new HRError('The HR request was invalid. Refresh and try again.');
    }
    const { supabase, businessId } = await this.managerContext();
    const { data, error } = await supabase.rpc('hr_write', { p_business_id: businessId, p_request_key: input.request_key,
      p_operation: input.operation, p_id: input.record_id ?? null, p_version: input.expected_version ?? null, p_data: input.details });
    if (error) {
      // Validation, constraint and permission errors are definite; anything else may have committed.
      const definite = /^(22|23|42|P0001)/.test(error.code || '');
      throw new HRError(definite ? hrErrorMessage(error.message) : 'The HR change was not confirmed. Retry to check whether it was applied.', !definite);
    }
    if (!data || typeof data !== 'object') throw new HRError('The HR change was not confirmed. Retry to check whether it was applied.', true);
    return data as Record<string, unknown>;
  }
}
