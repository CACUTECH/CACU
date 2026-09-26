
import { BaseService } from './base-service';

/**
 * @fileOverview NotificationService handles system alerts, emails, and in-app notifications.
 */
export class NotificationService extends BaseService {
  /**
   * Triggers a notification across configured channels.
   */
  async trigger(input: {
    userId?: string; // If missing, broadcasts to all admins of the business
    title: string;
    message: string;
    type: 'LOW_STOCK' | 'PAYMENT_RECEIVED' | 'INV_CREATED' | 'WELCOME' | 'SECURITY';
    metadata?: any;
    channels?: ('IN_APP' | 'EMAIL' | 'SMS')[];
  }) {
    const { supabase, businessId } = await this.getContext();
    if (!businessId) return;

    // 1. Resolve Target Users
    let targetUserIds: string[] = input.userId ? [input.userId] : [];

    if (!input.userId) {
      // Fetch all admins for the business
      const { data: admins } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('business_id', businessId)
        .in('role', ['owner', 'admin']);

      targetUserIds = admins?.map(a => a.user_id) || [];
    }

    // 2. Record in Database (Single Source of Truth)
    const records = targetUserIds.map(uid => ({
      business_id: businessId,
      user_id: uid,
      title: input.title,
      body: input.message,
      event_type: input.type,
      data: input.metadata,
    }));

    const { error: dbError } = await supabase.from('notifications').insert(records);
    if (dbError) console.error('Failed to record notifications:', dbError);

    // 3. External Channel Delivery (Placeholders)
    if (input.channels?.includes('EMAIL')) {
      await this.sendEmailBatch(targetUserIds, input.title, input.message);
    }
  }

  async listUnread() {
    const { supabase, user } = await this.getContext();
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async markAsRead(id: string) {
    const { supabase, user } = await this.getContext();
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
  }

  private async sendEmailBatch(userIds: string[], subject: string, body: string) {
    // Integration logic for Resend, SendGrid, etc.
    // In a real prod environment, this would call a server-side API
    console.log(`[STUB] Sending email batch to ${userIds.length} users: ${subject}`);
  }
}
