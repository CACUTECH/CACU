import { BaseService } from './base-service';
import { AI_UNAVAILABLE_MESSAGE } from '@/lib/ai-availability';

/** Guard retired server-action entrypoints, including requests from older clients. */
export class AIAvailabilityService extends BaseService {
  async requireUnavailable(scope: 'business' | 'hr'): Promise<never> {
    const { businessId, role } = await this.getContext();
    if (!businessId) throw new Error('Business context required');
    if (!role || !['owner', 'admin', 'editor', 'viewer'].includes(role)) {
      throw new Error('Insufficient permissions');
    }
    if (scope === 'hr' && role !== 'owner' && role !== 'admin') {
      throw new Error('Insufficient permissions');
    }
    // Deliberately no environment switch or provider import: a key is not activation.
    throw new Error(AI_UNAVAILABLE_MESSAGE);
  }
}
