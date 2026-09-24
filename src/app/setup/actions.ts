
'use server';

import { z } from "zod";
import { BusinessService } from "@/services/business-service";

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
    const service = new BusinessService();
    const business = await service.createBusiness(validated);
    return { success: true, businessId: business.id };
  } catch (error: any) {
    console.error('Business setup error:', error);
    throw new Error(error.message);
  }
}
