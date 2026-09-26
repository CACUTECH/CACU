
import { BaseService } from './base-service';

/**
 * @fileOverview HRService manages employee records and attendance.
 * Enforces business context and role-based access for workforce data.
 */
export class HRService extends BaseService {
  async listEmployees() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('business_id', businessId)
      .order('full_name');

    if (error) throw error;
    return data;
  }

  async addEmployee(employee: any) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    const { name, role, base_salary, status, ...rest } = employee;
    const payload: Record<string, unknown> = {
      ...rest,
      business_id: businessId,
      employment_status: status || 'Active',
      created_at: new Date().toISOString()
    };
    if (name !== undefined) payload.full_name = name;
    if (role !== undefined) payload.job_title = role;
    if (base_salary !== undefined) payload.monthly_salary = base_salary;

    const { data, error } = await supabase
      .from('employees')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getAttendanceToday() {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return [];

    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('attendance')
      .select('*, employees(full_name, job_title)')
      .eq('business_id', businessId)
      .gte('check_in', `${today}T00:00:00`)
      .lte('check_in', `${today}T23:59:59`);

    if (error) throw error;
    return data;
  }

  async logAttendance(employeeId: string, type: 'IN' | 'OUT') {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) throw new Error('Business context missing');

    const now = new Date().toISOString();

    if (type === 'IN') {
      const { data, error } = await supabase
        .from('attendance')
        .insert({
          business_id: businessId,
          employee_id: employeeId,
          check_in: now,
          status: 'Present'
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const today = now.split('T')[0];
      const { data, error } = await supabase
        .from('attendance')
        .update({ check_out: now })
        .eq('employee_id', employeeId)
        .eq('business_id', businessId)
        .gte('check_in', `${today}T00:00:00`)
        .is('check_out', null)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }
}
