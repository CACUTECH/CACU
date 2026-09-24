
-- CACU Production Schema Migration (Analytics & Reporting)

-- 1. Inventory Valuation View
CREATE OR REPLACE VIEW view_inventory_valuation AS
SELECT 
    business_id,
    COUNT(id) as total_skus,
    SUM(quantity) as total_items,
    SUM(quantity * price) as total_asset_value,
    COUNT(id) FILTER (WHERE quantity <= reorder_level) as low_stock_count
FROM catalog_items
WHERE type = 'Product'
GROUP BY business_id;

-- 2. Product Performance View
CREATE OR REPLACE VIEW view_product_performance AS
SELECT 
    si.business_id,
    ci.name as product_name,
    ci.sku,
    SUM(si.quantity) as units_sold,
    SUM(si.total_price) as total_revenue,
    MAX(s.created_at) as last_sold_at
FROM sale_items si
JOIN catalog_items ci ON si.catalog_item_id = ci.id
JOIN sales s ON si.sale_id = s.id
GROUP BY si.business_id, ci.name, ci.sku;

-- 3. Receivables Aging View
CREATE OR REPLACE VIEW view_receivables_aging AS
SELECT 
    business_id,
    CASE 
        WHEN due_date >= CURRENT_DATE THEN 'Current'
        WHEN due_date < CURRENT_DATE AND due_date >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30 Days'
        WHEN due_date < CURRENT_DATE - INTERVAL '30 days' AND due_date >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60 Days'
        WHEN due_date < CURRENT_DATE - INTERVAL '60 days' AND due_date >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90 Days'
        ELSE '90+ Days'
    END as bucket,
    SUM(total) as outstanding_amount,
    COUNT(id) as invoice_count
FROM invoices
WHERE type = 'Invoice' AND status != 'Paid' AND status != 'Cancelled'
GROUP BY business_id, bucket;

-- 4. KPI Aggregation Function
CREATE OR REPLACE FUNCTION get_business_kpis(p_business_id UUID, p_start_date DATE, p_end_date DATE)
RETURNS TABLE (
    total_income NUMERIC,
    total_expense NUMERIC,
    net_profit NUMERIC,
    transaction_count BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(amount) FILTER (WHERE type = 'Income'), 0) as total_income,
        COALESCE(SUM(amount) FILTER (WHERE type = 'Expense'), 0) as total_expense,
        COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE -amount END), 0) as net_profit,
        COUNT(id) as transaction_count
    FROM financial_transactions
    WHERE business_id = p_business_id
    AND date BETWEEN p_start_date AND p_end_date;
END;
$$;

-- 5. Revenue Trend Function
CREATE OR REPLACE FUNCTION get_revenue_trend(
    p_business_id UUID, 
    p_start_date DATE, 
    p_end_date DATE, 
    p_interval TEXT DEFAULT 'month'
)
RETURNS TABLE (
    period TEXT,
    income NUMERIC,
    expense NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        to_char(date_trunc(p_interval, date), 
            CASE 
                WHEN p_interval = 'day' THEN 'YYYY-MM-DD'
                WHEN p_interval = 'week' THEN 'IYYY-"W"IW'
                ELSE 'YYYY-MM'
            END
        ) as period,
        COALESCE(SUM(amount) FILTER (WHERE type = 'Income'), 0) as income,
        COALESCE(SUM(amount) FILTER (WHERE type = 'Expense'), 0) as expense
    FROM financial_transactions
    WHERE business_id = p_business_id
    AND date BETWEEN p_start_date AND p_end_date
    GROUP BY 1
    ORDER BY 1 ASC;
END;
$$;
