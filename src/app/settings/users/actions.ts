"use server";
import { ManagementService, ManagementWriteError, type ManagementMutation } from '@/services/management-service';
import { createClient } from '@/lib/supabase/server';
import { selectBusinessAction } from '@/app/business-actions';
import { revalidatePath } from 'next/cache';
export async function readWorkspaceAction(section: string, query: Record<string, unknown> = {}) {
    if (!['users', 'teams', 'sign-ins', 'usage'].includes(section))
        throw new Error('Unknown workspace section');
    return new ManagementService().read(section, query);
}
export async function mutateWorkspaceAction(input: ManagementMutation) {
    try {
        if (!['member.save', 'member.status', 'team.save', 'team.add', 'team.remove', 'location.save', 'invitation.create', 'invitation.resend', 'invitation.cancel'].includes(input.operation))
            throw new Error('Unsupported workspace operation');
        const data = await new ManagementService().write(input);
        // Email delivery remains disabled until the user reviews external SMTP/Auth setup.
        const warning = ['invitation.create', 'invitation.resend'].includes(input.operation) ? 'Invitation saved. Email delivery is disabled pending setup review. Share the invitation link with the intended recipient.' : undefined;
        revalidatePath('/settings/users');
        return { success: true as const, data, warning };
    }
    catch (e) {
        return { success: false as const, error: e instanceof Error ? e.message : 'Workspace update failed', uncertain: e instanceof ManagementWriteError ? e.uncertain : true };
    }
}
export async function acceptInvitationAction(id: string) {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user)
        throw new Error('Sign in with the invited email');
    const { data, error } = await client.rpc('accept_business_invitation', { p_invitation_id: id });
    if (error)
        throw new Error(error.message === 'PLAN_LIMIT users.max' ? 'This business has no free user seats on its plan. Ask the owner to make room or upgrade.' : error.message);
    await selectBusinessAction(data);
    return data as string;
}
export async function readTemplatesAction() {
    return new ManagementService().templates();
}
type TemplateResult = { success: true; data: unknown } | { success: false; error: string };
async function templateChange(work: (service: ManagementService) => Promise<unknown>): Promise<TemplateResult> {
    try {
        const data = await work(new ManagementService());
        revalidatePath('/settings/users');
        return { success: true, data };
    }
    catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'That change was not saved. Refresh and try again.' };
    }
}
export async function assignTemplateAction(userId: string, templateId: string) {
    return templateChange(service => service.assignTemplate(userId, templateId));
}
export async function saveTemplateAction(templateId: string | null, name: string, permissions: string[]) {
    return templateChange(service => service.saveTemplate(templateId, name, permissions));
}
export async function deleteTemplateAction(templateId: string) {
    return templateChange(service => service.deleteTemplate(templateId));
}
