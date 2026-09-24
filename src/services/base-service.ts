
import { createClient } from '@/lib/supabase/server';
import { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * @fileOverview Base class for all backend services.
 * Provides common logic for auth context and business identification.
 */
export abstract class BaseService {
  protected supabase: SupabaseClient;

  constructor() {
    // Initialized asynchronously in static 'init' or within methods
    this.supabase = null as any; 
  }

  protected async getContext() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Identify the active business for this user
    const { data: membership, error: memberError } = await supabase
      .from('business_members')
      .select('business_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (memberError || !membership) {
      // Note: During the setup flow, the user won't have a business yet.
      // BaseService consumers must handle this case or be used after setup.
      return { user, supabase, businessId: null, role: null };
    }

    return { user, supabase, businessId: membership.business_id, role: membership.role };
  }
}
