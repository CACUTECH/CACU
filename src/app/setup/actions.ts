
'use server';

import { z } from "zod";
import { BusinessService } from "@/services/business-service";
import { StorageService } from "@/services/storage-service";

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
    const service = new BusinessService();
    
    // 1. Create the business record first to get the ID
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

    // 2. If a logo was provided, upload it to the new business folder
    if (validated.logo_data_url) {
      try {
        const storage = new StorageService();
        // Base64 to Blob helper
        const res = await fetch(validated.logo_data_url);
        const blob = await res.blob();
        
        // This will be stored at {businessId}/branding/logo.png
        // We use an admin override here or ensure the user is already a member
        // (createBusiness already added them as Owner)
        const logoUrl = await storage.uploadFile(`branding/logo-${Date.now()}`, blob);
        
        await service.updateBusiness(business.id, { logo_url: logoUrl } as any);
      } catch (uploadError) {
        console.warn('Logo upload failed, but business was created:', uploadError);
      }
    }

    return { success: true, businessId: business.id };
  } catch (error: any) {
    console.error('Business setup error:', error);
    throw new Error(error.message);
  }
}
