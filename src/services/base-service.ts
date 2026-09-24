import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * @fileOverview Base class for all backend services.
 * Provides common logic for auth context and structured logging integration.
 */
export abstract class BaseService {
  protected supabase: SupabaseClient;
  protected serviceName: string;

  constructor() {
    this.supabase = null as any; 
    this.serviceName = this.constructor.name;
  }

  protected async getContext() {
    const startTime = Date.now();
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.security('Context Access Denied: No Session', { authError }, this.serviceName);
      throw new Error('Authentication required');
    }

    const { data: membership, error: memberError } = await supabase
      .from('business_members')
      .select('business_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (memberError || !membership) {
      return { user, supabase, businessId: null, role: null };
    }

    const duration = Date.now() - startTime;
    logger.perf('Get Context', duration, { businessId: membership.business_id }, this.serviceName);

    return { user, supabase, businessId: membership.business_id, role: membership.role };
  }

  protected logError(message: string, error: any, context?: any) {
    logger.error(message, error, context, this.serviceName);
  }

  protected logInfo(message: string, context?: any) {
    logger.info(message, context, this.serviceName);
  }
}
