-- Purchasing, part 3: supplier bills for received goods (Doc 10 purchase-to-payment; Doc 09 PR-18 with goods received
-- not invoiced, 2010).
--  * a bill matches quantities on the supplier's goods receipts. It posts Dr Goods received not invoiced, Cr Payables for
--    the billed amount, filed as a supplier bill so the bills list and supplier payments treat it like any other bill;
--  * where the bill differs from the received cost (a changed price, a delivery charge), the difference adjusts stock cost
--    (IAS 2, decided 7 November 2026): the share for units still in stock goes into their cost, the share for units already
--    sold goes to cost of sales, and Goods received not invoiced is cleared at the received cost;
--  * billed quantities can no longer be returned against the receipt (that needs a supplier credit).
SET LOCAL search_path = accounting, public, pg_catalog;

-- Which receipt lines a bill covers, and how its amount compared with what was received.
CREATE TABLE accounting.supplier_bill_receipt (
 business_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 receipt_id uuid NOT NULL,
 item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK (quantity > 0),
 received_value numeric(15,2) NOT NULL CHECK (received_value >= 0),
 billed_amount numeric(15,2) NOT NULL CHECK (billed_amount >= 0),
 to_stock numeric(15,2) NOT NULL,
 to_cost_of_sales numeric(15,2) NOT NULL,
 PRIMARY KEY (business_id, bill_id, receipt_id, item_id),
 FOREIGN KEY (business_id, receipt_id) REFERENCES accounting.goods_receipt(business_id, id),
 CHECK (to_stock + to_cost_of_sales = billed_amount - received_value)
);
CREATE INDEX supplier_bill_receipt_receipt ON accounting.supplier_bill_receipt (business_id, receipt_id);

ALTER TABLE accounting.supplier_bill_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting.supplier_bill_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON accounting.supplier_bill_receipt TO cacu_runtime
 USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
GRANT SELECT, INSERT ON accounting.supplier_bill_receipt TO cacu_runtime;
