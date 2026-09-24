
'use server';

import { z } from "zod";
import { BusinessService } from "@/services/business-service";
import { StorageService } from "@/services/storage-service";
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
  logo_data_url: z.string().optional(),
});

export async function createBusinessAction(data: z.infer<typeof businessSchema>) {
  try {
    const validated = businessSchema.parse(data);
    const supabase = await createClient();
    
    // CRITICAL SECURITY FIX (SEC-02): Check if user already has a business
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { data: existingMember } = await supabase
      .from('business_members')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    
    if (existingMember) {
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

    // 2. Logo upload with path protection
    if (validated.logo_data_url) {
      try {
        const storage = new StorageService();
        const res = await fetch(validated.logo_data_url);
        const blob = await res.blob();
        
        // This will be stored at {businessId}/branding/logo.png via StorageService logic
        const logoUrl = await storage.uploadFile(`branding/logo-${Date.now()}`, blob);
        
        await service.updateBusiness(business.id, { logo_url: logoUrl } as any);
      } catch (uploadError) {
        console.warn('Non-critical: Logo upload failed, but business was provisioned.', uploadError);
      }
    }

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
