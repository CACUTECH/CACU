# CACU: brag plan

**What it is:** CACU is a business management platform for Nigerian MSMEs. It covers POS, invoices, inventory, HR and payroll, accounting and reports in one app, for businesses that sell products, services, or both.
**Who it's for:** small business owners who still keep the books in a paper ledger, an Excel file, WhatsApp chats and a shoebox of receipts.
**What sets it apart:** one setup question ("What do you sell?") adapts the whole app to product, service or hybrid workflows. Amounts are in naira throughout, and it has a real accounting engine underneath.
**Visual hook:** four scattered "tools" (ledger, Excel, WhatsApp, receipts) get swept into a single purple CACU mark.
**Share caption:** "Paper ledger, Excel, WhatsApp orders, a shoebox of receipts. CACU replaces all four."

## Angle
"Four tools → one app." Open on the chaos the audience recognises, then show the app in use: setup choice → a POS sale → the dashboard updating.

- **Tone:** `default` (punchy, playful, clean), with soft transitions that dip through the background.
- **Format:** 1920×1080, 30 fps, 20.0 s.
- **Music:** 120 BPM (1 beat = 0.5 s, 1 bar = 2 s), A minor / C major, progression Am–F–C–G. Every cut lands on a beat.

## Visual identity (from `globals.css` / `tailwind.config.ts`)
- Background: dark theme `hsl(240 50% 6%)` (#08081a). Cards: `hsl(240 50% 9%)`. Borders: `hsl(240 15% 15%)`.
- Primary `hsl(250 100% 60%)` (#5233FF). Accent `hsl(265 89% 65%)`. Income #22c55e, expense #ef4444.
- Fonts: **Space Grotesk** (headlines), **Inter** (body), both loaded from Google Fonts the same way `layout.tsx` does.
- Icons: the real lucide-react v0.475 icon nodes, extracted from `node_modules`.
- UI recreated from the actual components: `StatCard` and `QuickAction` (`src/app/page.tsx`), the POS grid and Active Cart (`src/app/pos/page.tsx`), and the "What do you sell?" tiles (`src/app/setup/page.tsx`). UI copy comes straight from the source: "Business Snapshot", "Active Cart", "Complete Checkout", "Sale Recorded", "Revenue (MTD)", "Inventory Health".

## Storyboard (cuts on beats)

| # | Time | Scene | On screen | Audio |
|---|---|---|---|---|
| 1 | 0.0–3.0 | **Hook** | Caption "Still running your business on…". Four tilted cards pop in on beats (0.0 / 0.5 / 1.0 / 1.5): *Paper ledger*, *Excel sheets*, *WhatsApp orders*, *Receipt shoebox*. At 2.0 they wobble, then at 2.5 they get sucked to centre. | Filtered pluck on each pop, a riser from 2.0, impact at 3.0 |
| 2 | 3.0–6.0 | **Reveal** | Purple bloom. **CACU** letters stagger in, then "Your whole business. One app." and a "Built for Nigerian MSMEs" pill. | Full groove starts (kick, bass, pad) |
| 3 | 6.0–9.0 | **Setup** | "Welcome to CACU / What do you sell?" Products · Services · Hybrid tiles. The cursor clicks **Hybrid** at 7.5. Caption "Products. Services. Or both." | Soft click in key at 7.5 |
| 4 | 9.0–13.0 | **POS** | POS Checkout grid. Taps at 9.5 / 10.0 / 10.5 add items to Active Cart, and the total counts up. "Complete Checkout" is clicked at 11.5; the "Sale Recorded" toast appears at 12.0. Caption "Sell in seconds." | Clicks on taps, two-note chime on toast |
| 5 | 13.0–16.5 | **Dashboard** | "Business Snapshot": four StatCards stagger in on beats with count-up numbers, and the income/expense area chart draws. Caption "See every naira, in real time." | Hats open up |
| 6 | 16.5–20.0 | **Outro** | Module chips (POS, Invoices, Inventory, Payroll, Accounting, Storefront, Appointments, Credit) burst out, then collapse into the end card: **CACU**, "Your whole business. One app.", and the module row. | Final chord rings out, drums drop at 19.0 |

Total: 3 + 3 + 3 + 4 + 3.5 + 3.5 = **20.0 s**.

## Notes
- **Fictional stand-ins:** the business name ("Lekki Corner Mart"), catalog items, prices, receipt number and dashboard figures are all made up. No real customer or business data is used.
- **No public URL found** in the repo for "how to get it", so the end card closes on the name and tagline only.
