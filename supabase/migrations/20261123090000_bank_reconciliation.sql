-- Bank reconciliation (Doc 03 FR-134; Doc 09 month-end step 2; Doc 11 R3 POST /bank/statements (CSV), POST
-- /bank/matches; Doc 10 E14 R3). Owner decisions of 18 November 2026:
--  * any bank's CSV statement: the owner maps its date, description and amount (or money in and money out) columns
--    once, and CACU remembers the layout for that bank account;
--  * a statement line that matches nothing can be recorded from the reconciliation screen, money out as an expense and
--    money in as other income, posted and matched together; anything else can be marked explained with a note.
-- A statement line matches one ledger entry whose movement on that bank account is the same amount. Lines already
-- imported (an overlapping statement) are skipped. Parsing and matching are in the accounting API (cacu/accounting/bank.py).
SET LOCAL search_path = accounting, public, pg_catalog;

-- How a bank account's CSV is laid out, remembered from the last import.
CREATE TABLE accounting.bank_layout (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 account_id uuid NOT NULL,
 layout jsonb NOT NULL,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, account_id)
);

CREATE TABLE accounting.bank_statement (
 business_id uuid NOT NULL REFERENCES public.businesses(id),
 id uuid NOT NULL,
 account_id uuid NOT NULL,
 file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
 sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 lines integer NOT NULL CHECK (lines >= 0),
 skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
 first_date date,
 last_date date,
 imported_by uuid NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id, id),
 UNIQUE (business_id, account_id, sha256)
);

CREATE TABLE accounting.bank_line (
 business_id uuid NOT NULL,
 id uuid NOT NULL,
 statement_id uuid NOT NULL,
 account_id uuid NOT NULL,
 line_date date NOT NULL,
 description text NOT NULL CHECK (length(description) <= 500),
 amount numeric(19,2) NOT NULL CHECK (amount <> 0),  -- money in positive, money out negative
 balance numeric(19,2),
 position integer NOT NULL CHECK (position > 0),  -- the line's place in its statement, for same-day order
 fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'explained')),
 transaction_id integer,
 note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 3 AND 500),
 decided_by uuid,
 decided_at timestamptz,
 PRIMARY KEY (business_id, id),
 FOREIGN KEY (business_id, statement_id) REFERENCES accounting.bank_statement(business_id, id),
 UNIQUE (business_id, account_id, fingerprint),
 CHECK ((status = 'matched') = (transaction_id IS NOT NULL)),
 CHECK (status <> 'explained' OR note IS NOT NULL)
);
-- A ledger entry is matched to one statement line at most.
CREATE UNIQUE INDEX bank_line_one_match ON accounting.bank_line (business_id, account_id, transaction_id) WHERE status = 'matched';
CREATE INDEX bank_line_open ON accounting.bank_line (business_id, account_id, line_date) WHERE status = 'unmatched';

DO $rls$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['bank_layout', 'bank_statement', 'bank_line'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_access ON accounting.%I TO cacu_runtime USING (accounting.authorized(business_id)) WITH CHECK (accounting.authorized(business_id))', tab);
  EXECUTE format('REVOKE ALL ON accounting.%I FROM PUBLIC, anon, authenticated', tab);
 END LOOP;
END $rls$;
GRANT SELECT, INSERT, UPDATE ON accounting.bank_layout TO cacu_runtime;
GRANT SELECT, INSERT ON accounting.bank_statement TO cacu_runtime;
GRANT UPDATE (lines, skipped) ON accounting.bank_statement TO cacu_runtime;  -- counted once the lines are in
GRANT SELECT, INSERT ON accounting.bank_line TO cacu_runtime;
GRANT UPDATE (status, transaction_id, note, decided_by, decided_at) ON accounting.bank_line TO cacu_runtime;
