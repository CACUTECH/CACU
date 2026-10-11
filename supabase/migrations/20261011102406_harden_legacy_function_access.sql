-- Review in staging before production application. No tenant activation or data rewrite.
-- Existing signatures and financial behavior retained; legacy valuation/settlement defects remain separate release blockers.
BEGIN;

CREATE OR REPLACE FUNCTION public.process_sale(
  p_business_id UUID,
  p_customer_id UUID,
  p_items JSONB,
  p_payment_method TEXT,
  p_total_amount NUMERIC
) RETURNS UUID AS $$
DECLARE
  v_transaction_id UUID;
  v_item JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Business membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['owner', 'admin', 'editor']::public.membership_role[]) THEN
    RAISE EXCEPTION 'Business write permission required' USING ERRCODE = '42501';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM catalog_items
      WHERE id = (v_item->>'id')::UUID
      AND stock_quantity >= (v_item->>'quantity')::INTEGER
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for item %', v_item->>'name';
    END IF;
  END LOOP;

  INSERT INTO transactions (business_id, customer_id, created_by, status, payment_method, subtotal, total)
  VALUES (p_business_id, p_customer_id, auth.uid(), 'Completed', p_payment_method, p_total_amount, p_total_amount)
  RETURNING id INTO v_transaction_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO transaction_items (business_id, transaction_id, catalog_item_id, description, quantity, unit_price, line_total)
    VALUES (
      p_business_id,
      v_transaction_id,
      (v_item->>'id')::UUID,
      v_item->>'name',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'price')::NUMERIC,
      ((v_item->>'quantity')::NUMERIC * (v_item->>'price')::NUMERIC)
    );

    UPDATE catalog_items
    SET stock_quantity = stock_quantity - (v_item->>'quantity')::INTEGER
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;

  INSERT INTO financial_transactions (business_id, description, amount, type, category, reference_type, reference_id)
  VALUES (p_business_id, 'POS Sale: ' || v_transaction_id, p_total_amount, 'Income', 'Sales', 'Sale', v_transaction_id);

  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.process_sale(uuid,uuid,jsonb,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sale(uuid,uuid,jsonb,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_business_kpis(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE
) RETURNS TABLE (
  total_income NUMERIC,
  total_expense NUMERIC,
  net_profit NUMERIC,
  transaction_count BIGINT
) AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Business membership required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE -amount END), 0),
    COUNT(*)
  FROM financial_transactions
  WHERE business_id = p_business_id
  AND date BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.get_business_kpis(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_kpis(uuid,date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_revenue_trend(
  p_business_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_interval TEXT DEFAULT 'month'
) RETURNS TABLE (
  period TEXT,
  income NUMERIC,
  expense NUMERIC
) AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Business membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  RETURN QUERY
  SELECT
    TO_CHAR(
      DATE_TRUNC(
        CASE p_interval WHEN 'day' THEN 'day' WHEN 'week' THEN 'week' ELSE 'month' END,
        financial_transactions.date
      ),
      'YYYY-MM-DD'
    ) AS period,
    COALESCE(SUM(amount) FILTER (WHERE type = 'Income'), 0) AS income,
    COALESCE(SUM(amount) FILTER (WHERE type = 'Expense'), 0) AS expense
  FROM financial_transactions
  WHERE business_id = p_business_id
    AND date BETWEEN p_start_date AND p_end_date
  GROUP BY 1
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.get_revenue_trend(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_trend(uuid,date,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_audit(
  p_business_id UUID,
  p_action TEXT,
  p_table TEXT,
  p_record_id UUID,
  p_details JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Business membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  INSERT INTO audit_logs (business_id, user_id, action, table_name, record_id, details)
  VALUES (p_business_id, auth.uid(), p_action, p_table, p_record_id, p_details)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.record_audit(uuid,text,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_audit(uuid,text,text,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_item_id UUID,
  p_business_id UUID,
  p_delta INTEGER
) RETURNS VOID AS $$
DECLARE
  v_current INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Business membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['owner', 'admin', 'editor']::public.membership_role[]) THEN
    RAISE EXCEPTION 'Business write permission required' USING ERRCODE = '42501';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  SELECT stock_quantity INTO v_current
  FROM catalog_items
  WHERE id = p_item_id AND business_id = p_business_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF v_current + p_delta < 0 THEN
    RAISE EXCEPTION 'Insufficient stock';
  END IF;

  UPDATE catalog_items
  SET stock_quantity = v_current + p_delta
  WHERE id = p_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.adjust_inventory_stock(uuid,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid,uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_invoice_atomic(
  p_business_id UUID,
  p_customer_id UUID,
  p_invoice_number TEXT,
  p_type TEXT,
  p_status TEXT,
  p_date DATE,
  p_due_date DATE,
  p_subtotal NUMERIC,
  p_tax NUMERIC,
  p_total NUMERIC,
  p_vat_included BOOLEAN,
  p_notes TEXT,
  p_items JSONB
) RETURNS UUID AS $$
DECLARE
  v_invoice_id UUID;
  v_item JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Business membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['owner', 'admin', 'editor']::public.membership_role[]) THEN
    RAISE EXCEPTION 'Business write permission required' USING ERRCODE = '42501';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  INSERT INTO invoices (
    business_id, customer_id, invoice_number, type, status,
    issue_date, due_date, subtotal, tax, total, vat_included, notes
  ) VALUES (
    p_business_id, p_customer_id, p_invoice_number, p_type, p_status,
    p_date, p_due_date, p_subtotal, p_tax, p_total, p_vat_included, p_notes
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO invoice_items (business_id, invoice_id, catalog_item_id, description, quantity, unit_price, line_total)
    VALUES (
      p_business_id,
      v_invoice_id,
      NULLIF(v_item->>'catalog_item_id', '')::UUID,
      v_item->>'item_name',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC,
      (v_item->>'total_price')::NUMERIC
    );
  END LOOP;

  RETURN v_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.create_invoice_atomic(uuid,uuid,text,text,text,date,date,numeric,numeric,numeric,boolean,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(uuid,uuid,text,text,text,date,date,numeric,numeric,numeric,boolean,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_payment_atomic(
  p_business_id UUID,
  p_invoice_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_reference TEXT
) RETURNS UUID AS $$
DECLARE
  v_payment_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Business membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_business_role(p_business_id, ARRAY['owner', 'admin', 'editor']::public.membership_role[]) THEN
    RAISE EXCEPTION 'Business write permission required' USING ERRCODE = '42501';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Unauthorized: Access Denied';
  END IF;

  INSERT INTO payments (
    business_id, invoice_id, customer_id, amount, currency, channel,
    reference, status, initialized_by, initialized_at, verified_at
  ) VALUES (
    p_business_id, p_invoice_id, p_customer_id, p_amount, 'NGN', p_payment_method,
    p_reference, 'success', auth.uid(), now(), now()
  ) RETURNING id INTO v_payment_id;

  UPDATE invoices SET status = 'Paid', updated_at = now()
  WHERE id = p_invoice_id AND business_id = p_business_id;

  INSERT INTO financial_transactions (business_id, description, amount, type, category, created_by, reference_type, reference_id)
  VALUES (p_business_id, 'Invoice Payment Received', p_amount, 'Income', 'Sales', auth.uid(), 'Invoice', p_invoice_id);

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public.record_payment_atomic(uuid,uuid,uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment_atomic(uuid,uuid,uuid,numeric,text,text) TO authenticated;

COMMIT;
