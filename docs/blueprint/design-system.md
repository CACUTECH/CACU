> Blueprint v1 · 11 October 2026 · Repository baseline `71ba8d08dc677f69e5bf0d18a3f00b6c6b22db65`. Source audit and proposed target design; no production activation is implied.

# Design system and UI/UX brief

## Existing identity and proposed alignment

Audited assets: src/components/logo.tsx is an inline geometric SVG using CSS primary/primary-dark; primary-dark is not defined in inspected globals.css, so logo contrast/rendering needs verification. src/app/globals.css uses HSL primary 250 100% 60%, annotated #5233FF, accent 265 89% 65%, annotated #9370DB. Those comments do not equal exact CSS conversion; token HSL is authoritative until corrected. Layout loads Inter and Space Grotesk; Tailwind config maps body/headline. Radix/shadcn-style UI components and 0.75rem radius already exist. Preserve components and logo geometry pending brand-owner confirmation; do not invent a replacement logo.

Earlier user-provided CACU brand context lists #5C40FF, #233EFF, #FFA400, #712296 and #FF6E00. These are context references, not values verified in current CSS. Proposed alignment uses this palette through centralized semantic tokens after approval; alternatively keep current computed HSL. No source styling is changed by this documentation task. Use fonts already present, with system fallbacks/offline behavior.

## Principles

Plain Nigerian business language: “Customer owes you”, “Money received”, “Pending sync”; expose accounting terms in drilldown/help. Show NGN/₦ consistently with decimal-string financial source, thousands grouping and two money decimals. Separate cash from profit and unpaid invoices. Confirm irreversible financial actions with exact amount, customer, account, business and date. Success means committed server result. No fake lender offers, beneficiaries, storage counters or saved toasts. Preserve identity while adapting module visibility and dashboard content to business mode.

## Proposed tokens

| Token | Value / intent | Constraint |
|---|---|---|
| brand.primary | #5C40FF | Main action; white text on this background has approximately 5.78:1 contrast |
| brand.link | #233EFF | Link/focus emphasis; underline links in prose |
| brand.secondary | #712296 | Optional secondary emphasis, not financial status |
| brand.highlight | #FFA400 | Highlight background with dark text; never white normal text |
| brand.energy | #FF6E00 | Accent with dark text; never sole overdue/error indicator |
| surface / text | #FFFFFF / #171717 proposed | Readable default; existing dark scheme retained and tested separately |
| success / warning / danger | Semantic tokens inherited from component system, measured before approval | Icon + label, not colour alone; no unverified colour contrast claim |
| fonts | Inter body 14/16px; Space Grotesk headings 20/24/32px | System sans fallback, avoid forcing web-font network availability |
| numeric | Tabular numerals; right-align amounts | Decimal alignment, retain signs and currency labels |
| spacing | 4,8,12,16,24,32,48px | 16px mobile margin, 24px desktop; 8px control gap |
| border / radius | 1px semantic border; 12px card, 8px control proposed | Focus distinguishable from border, no decorative opacity hiding text |
| touch target | 44px comfortable default; WCAG minimum and spacing verified | Never shrink checkout controls for dense tables |
| breakpoints | 640,768,1024,1280px proposed | Test 360px to 1440px and 200% zoom; no horizontal body overflow |
| grid | Mobile 1 column, tablet 2, desktop up to 4 dashboard cards | Complex cart remains 2 columns only with enough width |
| motion | 150–200ms subtle, prefers-reduced-motion support | No animation required to understand state |

Contrast is calculated against solid palette values using WCAG relative luminance; recompute against actual themes/opacities. WCAG 2.2 AA requires measured text/control/focus contrast and keyboard/error/target checks [technical R16], not a compliance claim from these tokens.

## Component specifications

| Component | Behavior and states | Acceptance |
|---|---|---|
| Primary/secondary/destructive button | 44px preferred; distinct submit vs pending; disabled reason associated | Enter submits once; focus remains visible; pending does not create fresh retry key |
| Text/money/date input | Permanent label, hint, error ID; decimal-string input, no spinner rounding | Parse invalid NaN/exponent/negative where disallowed; maintain exact entered amount |
| Select/combobox | Searchable parties/items; keyboard list, create action gated | Foreign/stale result cannot be submitted; empty/error states differentiated |
| Table/list | Server pagination/sort; row action menu, column permission projection | Mobile cards retain critical number/status, secondary details drawer; no forbidden salary/cost column in payload |
| Card/KPI | Label, period, unit/currency, source date; loading/stale/empty/error | Missing metric shows unavailable, never 0 as query-failure fallback |
| Navigation | Business switch, mode-specific domain links, active item, restricted badge | Direct routes enforce same policy; owner billing accessible in restricted state |
| Dialog/drawer | Desktop dialog/mobile drawer, focus trap, accessible title, return focus | Escape closes draft unless deliberate unsaved-change review; no hidden commit |
| Financial confirmation | Exact source/customer, amount, account, date, balance effect and confirm | Payload change forces new review; pending timeout offers status/retry |
| Alert/toast | Alert for failure, polite status for success, actionable recovery link | Toast does not substitute persistent field error or imply simulated success |
| Charts | Distinct patterns/labels, legend, accessible data table, currency and date scope | Chart totals equal text/table; negative cash and overdue states remain readable without colour |
| Badge | Draft/issued/partially paid/paid/overdue; pending sync; plan restrictions | Text explains state; overdue is computed from date/balance, not stored-only truth |
| Empty/loading/error | Role-aware next step; layout-stable skeleton; retry preserves input | Do not show demo data when API fails or tenant has no records |
| Restricted feature | Explain missing permission vs plan vs accounting policy | Offer upgrade only for plan restriction; reader cannot request admin scope through button |
| File attachment | Purpose allowlist/size hint, pending/approved/rejected, authorized preview | No raw public object URL; validated download with neutral content handling |
| AI panel | Question + allowed suggestions; facts/as-of + generated interpretation; quota | Normal workflows remain usable on provider outage; draft review separate from confirmation |
| Sync panel | Per-operation pending/conflict/posted state and last sync | Final receipt only after posting acknowledgement; discard names affected drafts |

## Navigation and dashboard modes

Shared: Dashboard, Transactions/Expenses, Customers, Suppliers, Invoices, Reports, Settings, contextual AI. Product: Catalogue products, Inventory, Purchases, POS, low-stock/COGS widgets. Service: Services, Delivery/Jobs, outstanding invoices, service performance; omit irrelevant stock fields. Hybrid TOP: combined catalogue, product + service cart, stock and delivery tabs, blended dashboard; line types explicitly labeled. Subscription limits/role permissions determine actions within a module. HR, lending prototypes, community and integrations stay absent until their requirements are implemented.

Mobile bottom navigation proposed: Home, Sell/Invoice, Customers, Reports, More; adapt Sell to Service Invoice without changing accounting rules. Drawer contains inventory/service/settings links. Desktop left sidebar, persistent business selector and status; tablet collapsible sidebar. Always show active business at sale/receipt confirmation to prevent wrong-tenant posting.

## Representative wireframes

1. Dashboard: header business/mode/date; four permitted cards (cash received, revenue, expenses, customers owe); reconciliation indicator; trend with data table; Product low-stock or Service pending-delivery list; “Record sale”/“Issue invoice” CTA. Show cash/profit distinction beside metrics.
2. POS: top catalogue search/category; item cards left and cart right on desktop; mobile cart summary sticky with full-screen review. Customer and credit eligibility before partial/credit choice. Payment account selection and date visible at review; show pending offline separately.
3. Customer debt: name/contact + balance and due label; tabbed invoices/payments/statement/follow-up; prominent Record repayment; allocation drawer lists invoice outstanding and proposed amounts. Receipt shows prior debt, collected amount and resulting debt.
4. Cash flow: period/comparison filters, policy/timezone; opening cash, operating/investing/financing sections; cash reconciliation panel; detail table per line; export menu. Difference other than zero remains visible and prevents “reconciled” badge.
5. Billing/mode: approved tier comparison, actual usage/expiry; provider pending status; eligible Hybrid upgrade impact preview; history-preservation and restriction explanation. Never a client-side success timer.
6. Offline conflict: persistent banner, operation list with captured date and affected business; compare local draft versus current server quote/stock/period; Review/Retry/Discard. No silent merge of money.

## Screen/component mapping and design acceptance

| UX requirement | Screen group | Reused components / specialized behavior |
|---|---|---|
| UX-001 | FLOW-001 / PRD-001 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-002 | FLOW-002 / PRD-002 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-003 | FLOW-003 / PRD-003 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-004 | FLOW-004 / PRD-004 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-005 | FLOW-005 / PRD-005 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-006 | FLOW-006 / PRD-006 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-007 | FLOW-007 / PRD-007 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-008 | FLOW-008 / PRD-008 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-009 | FLOW-009 / PRD-009 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-010 | FLOW-010 / PRD-010 | App shell, labels, cards/list, status/error and permission-aware actions; exact financial confirmation and stable replay key |
| UX-011 | FLOW-011 / PRD-011 | App shell, labels, cards/list, status/error and permission-aware actions; exact financial confirmation and stable replay key |
| UX-012 | FLOW-012 / PRD-012 | App shell, labels, cards/list, status/error and permission-aware actions; exact financial confirmation and stable replay key |
| UX-013 | FLOW-013 / PRD-013 | App shell, labels, cards/list, status/error and permission-aware actions; exact financial confirmation and stable replay key |
| UX-014 | FLOW-014 / PRD-014 | App shell, labels, cards/list, status/error and permission-aware actions; date filters, data table, reconciliation and permitted drilldown |
| UX-015 | FLOW-015 / PRD-015 | App shell, labels, cards/list, status/error and permission-aware actions; exact financial confirmation and stable replay key |
| UX-016 | FLOW-016 / PRD-016 | App shell, labels, cards/list, status/error and permission-aware actions; exact financial confirmation and stable replay key |
| UX-017 | FLOW-017 / PRD-017 | App shell, labels, cards/list, status/error and permission-aware actions; exact financial confirmation and stable replay key |
| UX-018 | FLOW-018 / PRD-018 | App shell, labels, cards/list, status/error and permission-aware actions; date filters, data table, reconciliation and permitted drilldown |
| UX-019 | FLOW-019 / PRD-019 | App shell, labels, cards/list, status/error and permission-aware actions; date filters, data table, reconciliation and permitted drilldown |
| UX-020 | FLOW-020 / PRD-020 | App shell, labels, cards/list, status/error and permission-aware actions; pending/conflict operation list |
| UX-021 | FLOW-021 / PRD-021 | App shell, labels, cards/list, status/error and permission-aware actions; AI facts/source panel and separate reviewed draft |
| UX-022 | FLOW-022 / PRD-022 | App shell, labels, cards/list, status/error and permission-aware actions; AI facts/source panel and separate reviewed draft |
| UX-023 | FLOW-023 / PRD-023 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-024 | FLOW-024 / PRD-024 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-025 | FLOW-025 / PRD-025 | App shell, labels, cards/list, status/error and permission-aware actions |
| UX-026 | FLOW-026 / PRD-026 | App shell, labels, cards/list, status/error and permission-aware actions |

Design QA: test keyboard-only registration/checkout/repayment, visible focus and modal return, screen-reader labels/status, 200% zoom and 360px display, light/dark contrast, intermittent network, low-data device and font fallback. Test client changing tenant during report load. Confirm error text is understandable to a non-accountant in Nigerian pilot sessions. Record measured accessibility issues and resolve critical task blockers before pilot.
