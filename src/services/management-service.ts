import { BaseService } from './base-service';
import { READ_ONLY_MESSAGE } from '@/lib/read-only';
import { PERMISSION_MESSAGE, isPermissionRefusal } from '@/lib/permission';
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
        // An invitation with a template goes through invite_member, which creates the same invitation and remembers the template.
        const templated = input.operation === 'invitation.create' && typeof input.details.template_id === 'string';
        const { data, error } = templated
            ? await supabase.rpc('invite_member', { p_business_id: businessId, p_request_key: input.request_key, p_data: input.details })
            : await supabase.rpc('management_write', { p_business_id: businessId, p_request_key: input.request_key,
            p_operation: input.operation, p_id: input.item_id ?? null, p_version: input.expected_version ?? null, p_data: input.details });
        if (error)
            throw new ManagementWriteError(isPermissionRefusal(error) ? PERMISSION_MESSAGE : MANAGEMENT_MESSAGES[error.message] ?? error.message, !/^(22|23|42|P0001)/.test(error.code || ''));
        return data;
    }
    /** Every template the business can use, what each allows, and which template each member holds (Doc 08). */
    async templates(): Promise<TemplateCatalogue> {
        const { supabase, businessId } = await this.getContext();
        if (!businessId)
            throw new Error('Select a business');
        const { data, error } = await supabase.rpc('role_templates', { p_business_id: businessId });
        if (error)
            throw new Error(templateMessage(error));
        return data as TemplateCatalogue;
    }
    async assignTemplate(userId: string, templateId: string) {
        return this.templateCall('assign_role_template', { p_user_id: userId, p_template_id: templateId });
    }
    async saveTemplate(templateId: string | null, name: string, permissions: string[]) {
        return this.templateCall('save_role_template', { p_template_id: templateId, p_name: name, p_permissions: permissions });
    }
    async deleteTemplate(templateId: string) {
        return this.templateCall('delete_role_template', { p_template_id: templateId });
    }
    private async templateCall(fn: string, args: Record<string, unknown>) {
        const { supabase, businessId } = await this.getContext();
        if (!businessId)
            throw new Error('Select a business');
        const { data, error } = await supabase.rpc(fn, { p_business_id: businessId, ...args });
        if (error)
            throw new Error(templateMessage(error));
        return data;
    }
}
export type AccessTemplate = { id: string; code: string; name: string; builtin: boolean; legacy: boolean; role: string; permissions: string[]; members: number };
export type TemplateCatalogue = { custom_allowed: boolean; templates: AccessTemplate[]; assigned: Record<string, string | null> };
export function templateMessage(error: { message?: string | null }) {
    return isPermissionRefusal(error) ? PERMISSION_MESSAGE : MANAGEMENT_MESSAGES[error.message ?? ''] ?? 'That change was not saved. Refresh and try again.';
}
/** Plain wording for refusals people meet while managing their team; other codes pass through unchanged. */
const MANAGEMENT_MESSAGES: Record<string, string> = {
    SUBSCRIPTION_READ_ONLY: READ_ONLY_MESSAGE,
    INVITATION_LIMIT_REACHED: 'Too many invitations sent recently. Try again in an hour.',
    PLEASE_WAIT_BEFORE_RESENDING: 'This invitation was just sent. Wait a minute before resending it.',
    MEMBER_ALREADY_EXISTS: 'That person is already a member of this business.',
    INVALID_INVITATION: 'Enter a valid email address and choose what they can do.',
    TEMPLATE_INVALID: 'Choose one of the templates listed for this business.',
    TEMPLATE_EXCEEDS_YOUR_ACCESS: 'You can only give someone access you have yourself. Ask the business owner.',
    OWNER_PERMISSION_REQUIRED: "Only the owner can change an owner's access.",
    CANNOT_CHANGE_OWN_ACCESS: 'Ask another manager or the owner to change your own access.',
    ACTIVE_BUSINESS_MEMBER_REQUIRED: 'That person is no longer a member of this business. Refresh the list.',
    INVALID_NAME: 'Enter a name of up to 60 characters.',
    INVALID_PERMISSIONS: 'Choose at least one permission. Billing changes stay with the owner.',
    DUPLICATE_TEMPLATE_NAME: 'Another template already has that name.',
    TEMPLATE_IN_USE: 'Move everyone off this profile, and cancel invitations that use it, before deleting it.',
    'PLAN_LIMIT module.custom_roles': 'Custom profiles are on the Oga and Chairman plans. Upgrade in Billing to create one.',
    'PLAN_LIMIT users.max': 'Your plan has no free user seats. Open invitations hold a seat too. Cancel one, deactivate someone, or upgrade in Billing.',
    'PLAN_LIMIT outlets.max': 'Your plan has no room for another outlet. Upgrade in Billing to add one.',
    'PLAN_LIMIT catalog.max_items': 'Your plan has no room for more catalogue items. Archive items you no longer sell, or upgrade in Billing.',
};
