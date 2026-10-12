
'use server';

import { z } from "zod";
import { BusinessService } from "@/services/business-service";
import { selectBusinessAction } from "@/app/business-actions";

const businessSchema = z.object({
  requestKey: z.string().uuid(),
  name: z.string().trim().min(1).max(1000),
  type: z.enum(['PRODUCT', 'SERVICE', 'HYBRID']),
  sector: z.string().trim().min(1).max(1000),
  address: z.string().trim().min(1).max(1000),
  email: z.string().trim().email().max(1000),
  phone: z.string().trim().min(1).max(1000),
  bank_name: z.string().trim().min(1).max(1000),
  account_number: z.string().trim().min(1).max(1000),
  account_name: z.string().trim().min(1).max(1000),
});

export async function createBusinessAction(data: z.infer<typeof businessSchema>) {
  try {
    const validated = businessSchema.parse(data);
    const service = new BusinessService();

    // 1. Create the business record first
    const business = await service.createBusiness({
      requestKey: validated.requestKey,
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

    try { await selectBusinessAction(business.id); }
    catch { return { success: true, businessId: business.id, selectionPending: true }; }

    return { success: true, businessId: business.id };
  } catch (error: unknown) {

    // CRITICAL FIX (SEC-04): Return sanitized error message to client
    const friendlyMessage = error instanceof Error && error.message.includes('already registered')
      ? error.message
      : 'Business setup could not be confirmed. Retry with the same details.';
    throw new Error(friendlyMessage);
  }
}
