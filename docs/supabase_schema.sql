
-- ... existing schema ...

-- 12. STORAGE CONFIGURATION
-- Note: Run these in the Supabase SQL Editor to enable RLS on storage
-- insert into storage.buckets (id, name, public) values ('business-assets', 'business-assets', false);

-- POLICY: Multi-tenant file isolation
-- Ensures users can only access files in folders named after their business UUID
CREATE POLICY "Business Member Access" ON storage.objects
FOR ALL TO authenticated
USING (
  (storage.foldername(name))[1] IN (
    SELECT business_id::text 
    FROM public.business_members 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  (storage.foldername(name))[1] IN (
    SELECT business_id::text 
    FROM public.business_members 
    WHERE user_id = auth.uid()
  )
);

-- REFINEMENT: Add image/document support to tables
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS document_url TEXT;
