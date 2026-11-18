# Customer segments (Doc 18 R3 "E06 segments"; Doc 10 CRM)

**Where it comes from in the specification:**
- **Doc 10 CRM:** "Segments (R3): rules on spend, recency and tags, for example 'spent over ₦100,000 in 90 days' or 'no purchase in 60 days'." And: "Lifetime value (Empire, R3): total revenue from the customer less returns."
- **Doc 05 3F CRM:** segmentation was a listed gap.

No owner decision was needed. Doc 10's top plan "Empire" is today's Chairman.

## What happens

**Customers › Customer segments** (`/customers/segments`):
- **Rules.** The owner fills in only the rules they want, and a customer must meet every one:
  - spent at least, or less than, an amount in the last N days;
  - no purchase for N days (customers who have never bought count);
  - bought in the last N days;
  - owes at least an amount (what's outstanding now, less advances held);
  - tagged with any of a list of tags.
- **See who is in it** lists the customers it picks out now, with when each last bought, what they spent in 90 days, what they owe, their tags, and their lifetime value on Chairman.
- **Saving** gives the rules a name; names are unique, ignoring case. Saved segments show how many customers each holds now, in plain words ("spent ₦100,000 or more in 90 days, and tagged church"). They can be opened, changed, exported as CSV, or deleted.
- **Tags** are added from the customer list. Each customer has up to 20 tags of up to 30 characters, stored in lower case so "Church" and "church" are one tag.

**What "bought" means:** an issued invoice, less its credit notes. A credit sale at the till, a booking billed by invoice, or a job are all invoices, so they count.
- **Not counted:** walk-in cash sales, which name no customer; cancelled invoices; and what customers owed when the books started, which is an opening balance, not a purchase.

**Lifetime value** is everything invoiced to the customer since the books started, less credit notes.
- It's a Chairman feature (`crm.lifetime_value`). Businesses without a subscription, before billing launches, see it too.
- The accounting API asks only `accounting.lifetime_value_included(business)`, never the plan's other features.

## How it is stored

- **Tables:** `accounting.customer_tag` and `accounting.customer_segment`, both with row-level security like the other accounting tables.
- **Segments are rules,** worked out each time they're viewed, so they're always current.
- **Permissions:** viewing needs `customers.view`; saving segments and tags needs `customers.edit`; exporting needs `customers.export`.

**Not included yet:** sending a message to everyone in a segment. Doc 10 needs each customer's consent to marketing messages first, and it defaults to off.

## Tests

- `backend/tests/test_customer_segments_postgres.py`:
  - Tags tidied and limited.
  - Each rule, and rules combined.
  - Opening balances not counted as purchases.
  - Saving, counting, exporting and deleting segments; names unique.
  - Lifetime value on Chairman, hidden on a smaller plan, shown before billing.
- `src/tests/security/segments-ui.test.tsx`:
  - The form turned into rules, and rules in plain words.
  - Previewing and saving a segment.
  - Tagging a customer.
  - Lifetime value hidden below Chairman.
