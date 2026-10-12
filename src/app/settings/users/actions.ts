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
        // Email delivery remains unimplemented, as requested by the user.
        const warning = ['invitation.create', 'invitation.resend'].includes(input.operation) ? 'Invitation saved. Email delivery is unimplemented. Share the invitation link with the intended recipient.' : undefined;
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
        throw new Error(error.message);
    await selectBusinessAction(data);
    return data as string;
}
