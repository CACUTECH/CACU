# Credit notes on invoices (Doc 10 E12, Doc 09 PR-16)

Doc 18 puts E12 credit notes in R2. Doc 02 BP-06 sets the flow (request, approval, then a credit note or refund). Doc 09 PR-16 sets the posting, and ACC-010 and BR-002 say a posted invoice is corrected, never edited. Doc 11 lists `POST /credit-notes`.

Till sales already have refunds (POS part 3), and that design says credit sales "are corrected through invoice credit notes". This is that correction. It follows the refund rules so the two behave alike.

## Making one

Start from an issued invoice's menu, then **Credit note**. Anyone with `invoices.post` can ask. Each line of the invoice can take one of two things:

- **Units given back:** credited at what is left on the line per unit. The last units take whatever remains, so a line always credits to exactly what it charged.
  - **Back into stock:** for tracked products only, ticked by default. Goods return at the cost they left at (products on IFRS valuation use their valuation records).
  - **Damaged goods:** untick it. Their cost stays in cost of sales.
- **An amount off** (a price allowance, for example a torn bag). No stock moves. Later units given back share what is left after the allowance.

**Limits:**
- A credit note is never more than the invoice charged, less earlier credit notes. Waiting ones count too.
- Returns already recorded from the stock valuation screen also count.

**What is refused:** drafts (change or delete them instead), cancelled invoices, and invoices without a customer.

**Numbering:** credit notes are numbered per business: CN-0001, CN-0002 and so on.

## Approval (the owner's refund limit)

| Who asks | Credit note | What happens |
|---|---|---|
| Owner or Admin | Up to the owner's refund limit (no limit unless set) | Posted at once |
| Owner or Admin | Above the limit | Waits for another Owner or Admin |
| Anyone else with `invoices.post` (for example Editor) | Any amount | Waits for an Owner or Admin |

- **The limit:** it is the same refund limit the owner sets for till refunds. Only the owner changes it.
- **Separation of duties** (on by default) means nobody approves their own credit note. A requester can withdraw their own; rejecting someone else's needs a reason.
- **Where waiting ones are decided:** **Invoices › Refunds / Credits › Credit notes** (`/invoices/credit-notes`).
- **Owner or Admin only:** the posting engine already allows only them to post credit notes.
- **Decided once:** a credit note is decided once (database trigger), and is replay-safe under its request key.

## Posting

**Against the invoice, up to what is still owed (PR-16):**
- Debit the revenue account the invoice credited.
- Credit the customer's receivable, allocated to the invoice (posting kind `credit_note`).
- The invoice turns Paid when nothing is left. It records `credited_total`.

**Beyond what is still owed** (the invoice was already paid, in full or in part):
- Debit revenue, credit Customer deposits and advances (2100). This is a new internal posting kind, `credit_advance`.
- It is recorded as the customer's advance, naming the credit note. From there it can be applied to another invoice or handed back from the customer statement (E11).
- CACU does not pay money back directly from a credit note. Handing back an advance already has its own Owner/Admin check and records the cash or bank it is paid from.
- The first time this happens, Customer deposits and advances is added to the chart.

**A transfer still waiting for confirmation** does not reduce what the credit note can take. If it arrives after the invoice was credited, what the invoice no longer needs is kept as advance, as E11 already does.

**Restocked goods:** debit inventory, credit cost of sales, at the original cost (the code shared with till refunds).

**Customer statement:**
- Each credit note shows as **Credit note**, with its CN number and invoice.
- A part kept as advance shows as **Credit kept as advance**.

## Database

Migration `20261115090000_invoice_credit_notes.sql`:

- **`public.invoices.credited_total`.**
- **`accounting.invoice_credit`:** number, invoice, customer, amount, reason, status (pending, posted or rejected), the decision, and how much went against the invoice and how much to advance. It is decided once, its core fields never change, and it has one number per business.
- **`accounting.invoice_credit_line`:** units or an amount per invoice line, and whether it goes back to stock. It never changes.
- **`accounting.customer_advance.credit_id`:** an advance received comes from either a receipt or a credit note, never both.
- **Security:** row-level security is forced on both new tables for `cacu_runtime`.
- **No new SECURITY DEFINER functions.**

## API

| Method and path | Who |
|---|---|
| `GET /businesses/{id}/invoices/{invoice}/creditable` | `invoices.view`. Returns what each line can still credit, what is owed, the limit, and whether the caller approves |
| `POST /businesses/{id}/credit-notes` | `invoices.post`. Takes `request_key`, `invoice_id`, `reason`, and `lines` (`line_id`, `quantity`, `amount`, `restock`) |
| `GET /businesses/{id}/credit-notes?status=&invoice_id=` | `invoices.view`. Returns `can_approve` and `credit_notes` |
| `POST /businesses/{id}/credit-notes/{credit}/approve` | `invoices.post`, and Owner or Admin |
| `POST /businesses/{id}/credit-notes/{credit}/reject` | `invoices.post`. The requester withdraws their own; anyone else's needs an Owner or Admin |

## Not in this change

- A printable credit note PDF. The customer statement shows each one.
- Credit notes on supplier bills (supplier returns).

## Tests

- **`test_credit_notes_postgres.py` (3, on a business started from the real chart):**
  - A returned unit and a price allowance on an unpaid invoice, with goods back at cost.
  - A retried request credited once; over-credits refused; the last unit taking what is left.
  - CN numbers on the statement.
  - A credit on a part-paid invoice split between the invoice and the customer's advance, then handed back.
  - Viewers refused, an Editor's request waiting and holding its units, and an Admin approving it.
  - The owner's limit and separation of duties; rejection needing a reason; withdrawal.
  - Records that cannot change; the books balancing.
- **Jest `credit-notes-ui` (5):**
  - The per-unit and amount-off rules.
  - Posting with the advance shown, and "not both" refused.
  - Unticking back into stock.
  - Asking for approval.
  - Approving, rejecting only with a reason, withdrawing your own, and no decision buttons without rights.
