'use server';

import { z } from "zod";
import { format } from "date-fns";

const businessSchema = z.object({
  businessId: z.string(),
  ownerUid: z.string(),
  name: z.string().min(1),
  type: z.enum(['PRODUCT', 'SERVICE', 'HYBRID']),
  sector: z.string(),
  address: z.string(),
  email: z.string().email(),
  phone: z.string(),
  bank: z.object({
    name: z.string(),
    number: z.string(),
    accountName: z.string(),
  }),
});

/**
 * Server Action to provision a new business tenant atomically.
 * In a full production environment, this would use the Firebase Admin SDK 
 * to set Custom Claims (businessId and role) for the user.
 */
export async function createBusinessAction(data: z.infer<typeof businessSchema>) {
  // Validate input server-side
  const validated = businessSchema.parse(data);

  // Note: This logic assumes the caller is authenticated via Firebase.
  // We return the structured data to be written via a batch or secure client call 
  // (or perform the Admin write here if Admin SDK is configured).
  
  return {
    success: true,
    businessData: {
      ...validated,
      subscriptionLevel: "Starter",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    userData: {
      email: validated.email,
      role: "Owner",
      businessId: validated.businessId,
      createdAt: new Date().toISOString(),
    }
  };
}