import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { ACTIVE_BUSINESS_COOKIE, selectMembership } from '@/lib/business-selection';

/**
 * @fileOverview Base class for all backend services.
 * Provides common logic for auth context and structured logging integration.
 */
export abstract class BaseService {
  protected serviceName: string;

  constructor() {
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

    const selected = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
    let membership;
    if (selected) {
      const { data, error } = await supabase.from('memberships').select('business_id, role')
        .eq('user_id', user.id).eq('is_active', true).eq('business_id', selected).single();
      if (error || !data) throw new Error('Selected business membership is no longer valid');
      membership = data;
    } else {
      const { data, error } = await supabase.from('memberships').select('business_id, role')
        .eq('user_id', user.id).eq('is_active', true).limit(2);
      if (error) throw new Error('Unable to load business memberships');
      membership = selectMembership(data ?? []);
    }
    if (!membership) return { user, supabase, businessId: null, role: null };
    const duration = Date.now() - startTime;
    logger.perf('Get Context', duration, { businessId: membership.business_id }, this.serviceName);

    return { user, supabase, businessId: membership.business_id, role: membership.role };
  }

  protected logError(message: string, error: unknown, context?: Record<string, unknown>) {
    logger.error(message, error, context, this.serviceName);
  }

  protected logInfo(message: string, context?: Record<string, unknown>) {
    logger.info(message, context, this.serviceName);
  }
}
