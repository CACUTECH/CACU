import { BaseService } from './base-service';

export class MembershipService extends BaseService {
  async listActiveBusinessMembers() {
    const { supabase, businessId, role } = await this.getContext();
    if (!businessId || (role !== 'owner' && role !== 'admin')) {
      throw new Error('Owner or administrator access is required');
    }
    // No email, salary, profile metadata, or memberships of other businesses.
    const { data, error, count } = await supabase.from('memberships')
      .select('user_id, role', { count: 'exact' }).eq('business_id', businessId)
      .order('user_id').limit(100);
    if (error) throw new Error('Unable to load business members');
    return { members: data ?? [], total: count ?? 0 };
  }
}
