
'use server';

import { z } from "zod";
import { BusinessService } from "@/services/business-service";
import { selectBusinessAction } from "@/app/business-actions";
import { createClient } from "@/lib/supabase/server";

const businessSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['PRODUCT', 'SERVICE', 'HYBRID']),
  sector: z.string(),
  address: z.string(),
  email: z.string().email(),
  phone: z.string(),
  bank_name: z.string(),
  account_number: z.string(),
  account_name: z.string(),
});

export async function createBusinessAction(data: z.infer<typeof businessSchema>) {
  try {
    const validated = businessSchema.parse(data);
    const supabase = await createClient();
    
    // CRITICAL SECURITY FIX (SEC-02): Check if user already has a business
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: existingMembers, error: membershipError } = await supabase
      .from('memberships')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);
    if (membershipError) throw new Error('Unable to verify business memberships');
    
    if (existingMembers && existingMembers.length > 0) {
      throw new Error('User is already registered with a business. Multiple business ownership is restricted in this plan.');
    }

    const service = new BusinessService();
    
    // 1. Create the business record first
    const business = await service.createBusiness({
      name: validated.name,
      type: validated.type,
      sector: validated.sector,
      address: validated.address,
      email: validated.email,
      phone: validated.phone,
      bank_name: validated.bank_name,
      account_number: validated.account_number,
      account_name: validated.account_name,
    });

    await selectBusinessAction(business.id);

    return { success: true, businessId: business.id };
  } catch (error: any) {
    console.error('Production Setup Error:', error);
    // CRITICAL FIX (SEC-04): Return sanitized error message to client
    const friendlyMessage = error.message.includes('already registered') 
      ? error.message 
      : 'Provisioning failed due to an internal system error. Please contact CACU Support.';
    throw new Error(friendlyMessage);
  }
}
