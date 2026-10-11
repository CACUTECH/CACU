-- Generated from tested python-accounting 1.0.1 metadata; review before applying.

CREATE SCHEMA accounting;

REVOKE ALL ON SCHEMA accounting FROM PUBLIC;

SET LOCAL search_path = accounting, public, pg_catalog;

CREATE FUNCTION accounting.authorized(tenant uuid) RETURNS boolean
         LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
         SELECT tenant = nullif(current_setting('cacu.business_id', true), '')::uuid
         AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.business_id=tenant
             AND m.user_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid);
         $$;

CREATE TYPE accounting.accounttype AS ENUM ('NON_CURRENT_ASSET','CONTRA_ASSET','INVENTORY','BANK','CURRENT_ASSET','RECEIVABLE','NON_CURRENT_LIABILITY','CONTROL','CURRENT_LIABILITY','PAYABLE','RECONCILIATION','EQUITY','OPERATING_REVENUE','OPERATING_EXPENSE','NON_OPERATING_REVENUE','DIRECT_EXPENSE','OVERHEAD_EXPENSE','OTHER_EXPENSE');

CREATE TYPE accounting.balancetransactions AS ENUM ('CLIENT_INVOICE','SUPPLIER_BILL','JOURNAL_ENTRY');

CREATE TYPE accounting.balancetype AS ENUM ('DEBIT','CREDIT');

CREATE TYPE accounting.status AS ENUM ('OPEN','ADJUSTING','CLOSED');

CREATE TYPE accounting.transactiontype AS ENUM ('CASH_SALE','CLIENT_INVOICE','CREDIT_NOTE','CLIENT_RECEIPT','CASH_PURCHASE','SUPPLIER_BILL','DEBIT_NOTE','SUPPLIER_PAYMENT','CONTRA_ENTRY','JOURNAL_ENTRY');


CREATE TABLE recyclable (
	deleted_at TIMESTAMP WITHOUT TIME ZONE, 
	destroyed_at TIMESTAMP WITHOUT TIME ZONE, 
	recycled_type VARCHAR(255) NOT NULL, 
	id SERIAL NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."recyclable" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."recyclable" ADD UNIQUE (id, business_id);


CREATE TABLE currency (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	code VARCHAR(3) NOT NULL, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."currency" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."currency" ADD UNIQUE (id, business_id);


CREATE TABLE "user" (
	name VARCHAR(255) NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	entity_id INTEGER NOT NULL, 
	id SERIAL NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."user" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."user" ADD UNIQUE (id, business_id);


CREATE TABLE recycled (
	recycled_id INTEGER NOT NULL, 
	restored_at TIMESTAMP WITHOUT TIME ZONE, 
	entity_id INTEGER NOT NULL, 
	id SERIAL NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."recycled" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."recycled" ADD UNIQUE (id, business_id);


CREATE TABLE reporting_period (
	id INTEGER NOT NULL, 
	calendar_year INTEGER NOT NULL, 
	period_count INTEGER NOT NULL, 
	status status NOT NULL, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (calendar_year, entity_id), 
	UNIQUE (period_count, entity_id)
)

;

ALTER TABLE accounting."reporting_period" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."reporting_period" ADD UNIQUE (id, business_id);


CREATE TABLE entity (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	multi_currency BOOLEAN NOT NULL, 
	mid_year_balances BOOLEAN NOT NULL, 
	year_start INTEGER NOT NULL, 
	locale VARCHAR(5) NOT NULL, 
	currency_id INTEGER, 
	reporting_period_id INTEGER, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."entity" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."entity" ADD UNIQUE (id, business_id);


CREATE TABLE account (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	description VARCHAR(1000), 
	account_code INTEGER NOT NULL, 
	account_type accounttype NOT NULL, 
	currency_id INTEGER NOT NULL, 
	category_id INTEGER, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."account" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."account" ADD UNIQUE (id, business_id);


CREATE TABLE category (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	category_account_type accounttype NOT NULL, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."category" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."category" ADD UNIQUE (id, business_id);


CREATE TABLE line_item (
	id INTEGER NOT NULL, 
	narration VARCHAR(1000) NOT NULL, 
	quantity DECIMAL(13, 4) NOT NULL, 
	amount DECIMAL(13, 4) NOT NULL, 
	credited BOOLEAN NOT NULL, 
	tax_inclusive BOOLEAN NOT NULL, 
	account_id INTEGER NOT NULL, 
	transaction_id INTEGER, 
	tax_id INTEGER, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."line_item" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."line_item" ADD UNIQUE (id, business_id);

ALTER TABLE accounting."line_item" ALTER COLUMN "quantity" TYPE numeric(19,4);

ALTER TABLE accounting."line_item" ALTER COLUMN "amount" TYPE numeric(19,4);


CREATE TABLE transaction (
	id INTEGER NOT NULL, 
	transaction_date TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	transaction_no VARCHAR(255), 
	transaction_type transactiontype NOT NULL, 
	narration VARCHAR(1000) NOT NULL, 
	reference VARCHAR(255), 
	main_account_amount DECIMAL(13, 4) NOT NULL, 
	credited BOOLEAN NOT NULL, 
	compound BOOLEAN NOT NULL, 
	currency_id INTEGER NOT NULL, 
	account_id INTEGER NOT NULL, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (transaction_no, entity_id)
)

;

ALTER TABLE accounting."transaction" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."transaction" ADD UNIQUE (id, business_id);

ALTER TABLE accounting."transaction" ALTER COLUMN "main_account_amount" TYPE numeric(19,4);


CREATE TABLE balance (
	id INTEGER NOT NULL, 
	transaction_date TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	reference VARCHAR(255), 
	transaction_no VARCHAR(255) NOT NULL, 
	transaction_type balancetransactions NOT NULL, 
	amount DECIMAL(13, 4) NOT NULL, 
	balance_type balancetype NOT NULL, 
	currency_id INTEGER NOT NULL, 
	account_id INTEGER NOT NULL, 
	reporting_period_id INTEGER NOT NULL, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."balance" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."balance" ADD UNIQUE (id, business_id);

ALTER TABLE accounting."balance" ALTER COLUMN "amount" TYPE numeric(19,4);


CREATE TABLE tax (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	code VARCHAR(5) NOT NULL, 
	rate DECIMAL(13, 4) NOT NULL, 
	account_id INTEGER, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."tax" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."tax" ADD UNIQUE (id, business_id);

ALTER TABLE accounting."tax" ALTER COLUMN "rate" TYPE numeric(19,4);


CREATE TABLE ledger (
	id INTEGER NOT NULL, 
	transaction_date TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	entry_type balancetype NOT NULL, 
	amount DECIMAL(13, 4) NOT NULL, 
	hash VARCHAR(500), 
	transaction_id INTEGER NOT NULL, 
	currency_id INTEGER NOT NULL, 
	post_account_id INTEGER NOT NULL, 
	folio_account_id INTEGER NOT NULL, 
	line_item_id INTEGER, 
	tax_id INTEGER, 
	entity_id INTEGER NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."ledger" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."ledger" ADD UNIQUE (id, business_id);

ALTER TABLE accounting."ledger" ALTER COLUMN "amount" TYPE numeric(19,4);


CREATE TABLE assignment (
	assignment_date TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	transaction_id INTEGER, 
	assigned_id INTEGER NOT NULL, 
	assigned_type VARCHAR(255) NOT NULL, 
	assigned_no VARCHAR(255) NOT NULL, 
	amount DECIMAL(13, 4) NOT NULL, 
	entity_id INTEGER NOT NULL, 
	id SERIAL NOT NULL, 
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL, 
	PRIMARY KEY (id)
)

;

ALTER TABLE accounting."assignment" ADD COLUMN business_id uuid NOT NULL DEFAULT nullif(current_setting('cacu.business_id', true), '')::uuid REFERENCES public.businesses(id);

ALTER TABLE accounting."assignment" ADD UNIQUE (id, business_id);

ALTER TABLE accounting."assignment" ALTER COLUMN "amount" TYPE numeric(19,4);

ALTER TABLE accounting."currency" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."currency" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."user" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."recycled" ADD FOREIGN KEY ("recycled_id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."recycled" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."reporting_period" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."reporting_period" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."entity" ADD FOREIGN KEY ("currency_id", business_id) REFERENCES accounting."currency" (id, business_id);

ALTER TABLE accounting."entity" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."entity" ADD FOREIGN KEY ("reporting_period_id", business_id) REFERENCES accounting."reporting_period" (id, business_id);

ALTER TABLE accounting."account" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."account" ADD FOREIGN KEY ("currency_id", business_id) REFERENCES accounting."currency" (id, business_id);

ALTER TABLE accounting."account" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."account" ADD FOREIGN KEY ("category_id", business_id) REFERENCES accounting."category" (id, business_id);

ALTER TABLE accounting."category" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."category" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."line_item" ADD FOREIGN KEY ("account_id", business_id) REFERENCES accounting."account" (id, business_id);

ALTER TABLE accounting."line_item" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."line_item" ADD FOREIGN KEY ("tax_id", business_id) REFERENCES accounting."tax" (id, business_id);

ALTER TABLE accounting."line_item" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."line_item" ADD FOREIGN KEY ("transaction_id", business_id) REFERENCES accounting."transaction" (id, business_id);

ALTER TABLE accounting."transaction" ADD FOREIGN KEY ("account_id", business_id) REFERENCES accounting."account" (id, business_id);

ALTER TABLE accounting."transaction" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."transaction" ADD FOREIGN KEY ("currency_id", business_id) REFERENCES accounting."currency" (id, business_id);

ALTER TABLE accounting."transaction" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."balance" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."balance" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."balance" ADD FOREIGN KEY ("account_id", business_id) REFERENCES accounting."account" (id, business_id);

ALTER TABLE accounting."balance" ADD FOREIGN KEY ("currency_id", business_id) REFERENCES accounting."currency" (id, business_id);

ALTER TABLE accounting."balance" ADD FOREIGN KEY ("reporting_period_id", business_id) REFERENCES accounting."reporting_period" (id, business_id);

ALTER TABLE accounting."tax" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."tax" ADD FOREIGN KEY ("account_id", business_id) REFERENCES accounting."account" (id, business_id);

ALTER TABLE accounting."tax" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("post_account_id", business_id) REFERENCES accounting."account" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("line_item_id", business_id) REFERENCES accounting."line_item" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("currency_id", business_id) REFERENCES accounting."currency" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("tax_id", business_id) REFERENCES accounting."tax" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("id", business_id) REFERENCES accounting."recyclable" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("transaction_id", business_id) REFERENCES accounting."transaction" (id, business_id);

ALTER TABLE accounting."ledger" ADD FOREIGN KEY ("folio_account_id", business_id) REFERENCES accounting."account" (id, business_id);

ALTER TABLE accounting."assignment" ADD FOREIGN KEY ("entity_id", business_id) REFERENCES accounting."entity" (id, business_id);

ALTER TABLE accounting."assignment" ADD FOREIGN KEY ("transaction_id", business_id) REFERENCES accounting."transaction" (id, business_id);

ALTER TABLE accounting."recyclable" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."recyclable" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."recyclable" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."currency" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."currency" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."currency" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."user" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."user" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."user" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."recycled" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."recycled" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."recycled" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."reporting_period" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."reporting_period" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."reporting_period" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."entity" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."entity" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."entity" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."account" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."account" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."account" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."category" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."category" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."category" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."line_item" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."line_item" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."line_item" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."transaction" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."transaction" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."transaction" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."balance" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."balance" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."balance" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."tax" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."tax" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."tax" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."ledger" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."ledger" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."ledger" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));

ALTER TABLE accounting."assignment" ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting."assignment" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_access ON accounting."assignment" TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id));
