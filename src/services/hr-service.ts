
import { BaseService } from './base-service';

/**
 * @fileOverview HRService manages employee records and attendance.
 * Enforces business context and role-based access for workforce data.
 */
export class HRService extends BaseService {
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

  async listEmployees() {
    const { supabase, businessId, role: actorRole } = await this.getContext();
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new Error('HR access is restricted to owners and administrators');
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
    const { supabase, businessId, role: actorRole } = await this.getContext();
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new Error('HR access is restricted to owners and administrators');
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
    const { supabase, businessId, role: actorRole } = await this.getContext();
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new Error('HR access is restricted to owners and administrators');
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
    const { supabase, businessId, role: actorRole } = await this.getContext();
    if (actorRole !== 'owner' && actorRole !== 'admin') throw new Error('HR access is restricted to owners and administrators');
    if (!businessId) throw new Error('Business context missing');

    const { data: employee, error: employeeError } = await supabase.from('employees')
      .select('id').eq('business_id', businessId).eq('id', employeeId).single();
    if (employeeError || !employee) throw new Error('Employee unavailable in this business');

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
