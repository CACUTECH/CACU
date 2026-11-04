-- CACU invoices and receipts as PDFs (Doc 14 SUB-14). The billing history gains what the documents print: the VAT
-- rate, the period an invoice covers and how a receipt was paid. Owners and Admins only, as before.
SET LOCAL search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION public.business_billing_history(p_business_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF NOT EXISTS (SELECT FROM public.memberships WHERE business_id = p_business_id AND user_id = auth.uid() AND is_active
                AND role::text IN ('owner','admin')) THEN
  RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('invoice', i.number, 'plan', i.plan_code, 'billing_interval', i.billing_interval,
   'kind', i.kind, 'subtotal_kobo', i.subtotal_kobo, 'vat_rate_bps', i.vat_rate_bps, 'vat_kobo', i.vat_kobo, 'total_kobo', i.total_kobo,
   'status', i.status, 'created_at', i.created_at, 'paid_at', i.paid_at, 'period_start', i.period_start, 'period_end', i.period_end,
   'receipt', r.number, 'receipt_amount_kobo', r.amount_kobo, 'channel', r.channel) ORDER BY i.created_at DESC)
  FROM platform.invoices i LEFT JOIN platform.receipts r ON r.invoice_id = i.id WHERE i.business_id = p_business_id), '[]'::jsonb);
END $$;
