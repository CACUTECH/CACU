import { BaseService } from './base-service';
import { accountingRequest, usesPythonAccounting } from '@/lib/accounting-client';
export class ManagementWriteError extends Error {
    constructor(message: string, public readonly uncertain: boolean) { super(message); this.name = 'ManagementWriteError'; }
}
export type ManagementMutation = {
    request_key: string;
    operation: string;
    item_id?: string | null;
    expected_version?: number | null;
    details: Record<string, unknown>;
};
export class ManagementService extends BaseService {
    async read(section: string, query: Record<string, unknown> = {}) {
        const { supabase, businessId } = await this.getContext();
        if (!businessId)
            throw new Error('Select a business');
        const { data, error } = await supabase.rpc('management_read', { p_business_id: businessId, p_section: section, p_query: query });
        if (error)
            throw new Error(error.message);
        return data;
    }
    async write(input: ManagementMutation) {
        const { supabase, businessId } = await this.getContext();
        if (!businessId)
            throw new Error('Select a business');
        if (['item.save', 'stock.adjust'].includes(input.operation) && await usesPythonAccounting()) {
            return accountingRequest<Record<string, unknown>>('catalog', { method: 'POST', body: input });
        }
        const { data, error } = await supabase.rpc('management_write', { p_business_id: businessId, p_request_key: input.request_key,
            p_operation: input.operation, p_id: input.item_id ?? null, p_version: input.expected_version ?? null, p_data: input.details });
        if (error)
            throw new ManagementWriteError(MANAGEMENT_MESSAGES[error.message] ?? error.message, !/^(22|23|42|P0001)/.test(error.code || ''));
        return data;
    }
}
/** Plain wording for refusals people meet while managing their team; other codes pass through unchanged. */
const MANAGEMENT_MESSAGES: Record<string, string> = {
    INVITATION_LIMIT_REACHED: 'Too many invitations sent recently. Try again in an hour.',
    PLEASE_WAIT_BEFORE_RESENDING: 'This invitation was just sent. Wait a minute before resending it.',
    MEMBER_ALREADY_EXISTS: 'That person is already a member of this business.',
    INVALID_INVITATION: 'Enter a valid email address and choose Admin, Editor or Viewer.',
    'PLAN_LIMIT users.max': 'Your plan has no free user seats. Open invitations hold a seat too. Cancel one, deactivate someone, or upgrade in Billing.',
    'PLAN_LIMIT outlets.max': 'Your plan has no room for another outlet. Upgrade in Billing to add one.',
    'PLAN_LIMIT catalog.max_items': 'Your plan has no room for more catalogue items. Archive items you no longer sell, or upgrade in Billing.',
};
