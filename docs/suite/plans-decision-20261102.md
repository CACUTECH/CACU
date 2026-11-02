# Plans and pricing decision (2 November 2026)

Owner decision, replacing the plan names in DEC-002 (Doc 01) and the pilot-entitlement item in the status list of 2 November 2026.

## Plans

| Internal code | Plan | Price (NGN, monthly) | Hybrid mode |
|---|---|---|---|
| `BASE` | General Plan (starter) | ₦1,500 | No |
| `GROW` | Oga Plan | ₦6,000 | No |
| `TOP` | Chairman Plan (highest) | ₦15,000 | Yes, the only plan with Hybrid |

- The prices and the Hybrid rule are unchanged from DEC-002. Only the display names change: Founder becomes General, Innovator becomes Oga, and Empire becomes Chairman.
- The internal codes `BASE`, `GROW` and `TOP` stay as the stable keys. Database rows, entitlement checks and billing events use the codes, never the display names.

## No free pilot

- There is no free pilot plan. Pilot businesses subscribe to one of the three paid plans.
- Remove "free pilot plan (pilot entitlement)" from the build list. The entitlement work in Doc 14 builds only these three plans.
- This record doesn't decide trials or the grace period. The blueprint's proposal stands until the owner decides otherwise: no automatic trial at first release, and a seven-day grace period still awaiting commercial approval.

## Effect on the code

- Nothing enforces plans today, so no behaviour changes.
- `src/components/subscription-guard.tsx` and `docs/backend.json` still use the old placeholders `Starter`, `Growth` and `Enterprise`. Replace them with the codes above when entitlements are built (Doc 14).
- A request from a `BASE` or `GROW` business to switch to Hybrid mode must fail in the API as well as the UI (acceptance AT-004).
