'use server';

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const businessSchema = z.object({
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

export async function createBusinessAction(data: z.infer<typeof businessSchema>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const validated = businessSchema.parse(data);

  // Use a transaction-like approach in Supabase
  // 1. Create Business
  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .insert({
      name: validated.name,
      business_type: validated.type,
      sector: validated.sector,
      address: validated.address,
      email: validated.email,
      phone: validated.phone,
      bank_name: validated.bank.name,
      account_number: validated.bank.number,
      account_name: validated.bank.accountName,
    })
    .select()
    .single();

  if (bizError) throw bizError;

  // 2. Create Profile (if not exists)
  await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email!,
    full_name: user.user_metadata.full_name || validated.name,
  });

  // 3. Create Business Membership (Owner)
  const { error: memberError } = await supabase
    .from('business_members')
    .insert({
      business_id: business.id,
      user_id: user.id,
      role: 'Owner',
    });

  if (memberError) throw memberError;

  return { success: true, businessId: business.id };
}
