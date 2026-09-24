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
  bank_name: z.string(),
  account_number: z.string(),
  account_name: z.string(),
});

export async function createBusinessAction(data: z.infer<typeof businessSchema>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const validated = businessSchema.parse(data);

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
      bank_name: validated.bank_name,
      account_number: validated.account_number,
      account_name: validated.account_name,
    })
    .select()
    .single();

  if (bizError) {
    console.error('Error creating business:', bizError);
    throw new Error(bizError.message);
  }

  // 2. Create/Update Profile (linked to auth.users)
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    email: user.email!,
    full_name: user.user_metadata?.full_name || validated.name,
  });

  if (profileError) {
    console.error('Error creating profile:', profileError);
    throw new Error(profileError.message);
  }

  // 3. Create Business Membership (Owner)
  const { error: memberError } = await supabase
    .from('business_members')
    .insert({
      business_id: business.id,
      user_id: user.id,
      role: 'Owner',
    });

  if (memberError) {
    console.error('Error creating membership:', memberError);
    throw new Error(memberError.message);
  }

  return { success: true, businessId: business.id };
}
