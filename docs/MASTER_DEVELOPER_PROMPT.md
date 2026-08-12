# CACU Master Mobile App Developer Prompt

You are an expert full-stack mobile app developer. Your goal is to build a unified Business Management Platform (ERP) for Nigerian MSMEs called **CACU**. The platform must be adaptive, modular, and AI-powered.

## 🚀 Vision
A single app that reconfigures its UI and logic based on the user's business model:
1. **Product-Based**: Retail/Wholesale focus (Inventory, POS, Suppliers).
2. **Service-Based**: Professional/Repairs focus (Jobs, Appointments, Appointments).
3. **Hybrid**: Unified goods and services.

---

## 🛠 CORE MODULES & FUNCTIONAL SPECIFICATIONS

### 1. Adaptive Identity & Setup
- **Function**: Capture business name, sector, and operating model.
- **Logic**: Store `businessType` in global state. If `SERVICE`, hide Inventory Stock counts; if `PRODUCT`, hide Job Workboards.
- **Branding**: Allow logo upload and primary color theme selection.

### 2. AI-Powered HR Suite
#### A. Smart Onboarding
- **Function**: Initialize new hire profiles.
- **AI Logic**: Integrate a GenAI flow to generate "Offer Letters" and "Employment Contracts" based on role and salary.
- **Checklist**: Track IT access, asset assignment, and document signing.

#### B. Professional Payroll (Maker-Checker)
- **Validation Engine**: Pre-payroll "Sweep" to flag missing bank details or negative net pay.
- **Maker-Checker**: HR prepares pay; Internal Audit approves; Finance disburses.
- **Statutory Logic**: Automatic calculation of Nigerian PAYE, Pension (8%/10%), and NHF (2.5%).

#### C. Exit & Termination
- **Offboarding Flow**: Checklist for asset return and final clearance.
- **AI Logic**: Generate professional "Resignation Acceptance" or "Termination Notices" based on the exit reason.

### 3. Unified Sales & Digital Presence
#### A. POS & Inventory
- **POS Checkout**: Searchable inventory list, cart management, and multi-mode payment (Cash, Card, Transfer).
- **Inventory Sync**: Real-time decrement of stock levels upon POS sale or Invoice fulfillment.
- **Alerts**: Automatic "Low Stock" notifications based on reorder levels.

#### B. WhatsApp Digital Storefront
- **Configuration**: Setup store bio, social links, and WhatsApp Business number.
- **Checkout Logic**: "Send Order to WhatsApp" button that formats the cart into a readable message for the merchant.

### 4. Financial Integrity (Accounting)
- **Chart of Accounts**: Structured ledger with Asset, Liability, Equity, Income, and Expense categories.
- **Journal Adjustments**: Manual double-entry validation (Debits must equal Credits).
- **Trial Balance**: Real-time integrity check of all ledger balances.

### 5. Analytics & Growth
- **KPI Dashboard**: Profit margins, Average Transaction Value, and Revenue Growth trends.
- **Budgeting**: "Budget vs. Actual" variance analysis by department.
- **Reconciliation**: Matching bank API/CSV statements with internal ledger records.

---

## 🎨 UI/UX GUIDELINES
- **Design System**: Use ShadCN UI components with Radix primitives.
- **Color Palette**: Primary (#5233FF), Accent (#9370DB).
- **Responsiveness**: Mobile-first grid layouts.
- **Visuals**: Use Recharts for professional financial data visualization.

---

## 🤖 AI ASSISTANT SPECS
- **Context-Awareness**: The AI must read the `innerText` of the current page to provide specific advice (e.g., if on Inventory page, advise on stock turnover).
- **Genkit Integration**: Use Genkit flows for all structured text generation (Letters, Notes to Account, Support Replies).

## 📊 DATA MODELS
- `Employee`: { id, name, role, baseSalary, bankInfo, status }
- `CatalogItem`: { id, name, type (Product/Service), price, quantity }
- `Job`: { id, title, customer, assignedStaff, status, dueDate }
- `Transaction`: { id, amount, type (Income/Expense), category, account }

---

**Next Steps**: Initialize the project structure using Next.js 15, setup the adaptive layout sidebar, and begin by building the "Business Setup Wizard".