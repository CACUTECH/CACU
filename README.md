# CACU Business Management Platform

CACU Technologies Limited provides a unified ERP solution designed to empower Nigerian MSMEs. This platform dynamically adapts to support **Product-based**, **Service-based**, and **Hybrid** business models from a single, high-performance architecture.

---

## 🚀 Production-Ready Architecture

The platform has been re-engineered for extreme scalability and security, utilizing a relational backend capable of supporting **1 million+ consumer users** with strict multi-tenant isolation.

### 🛡️ Security & Scalability Features
- **Multi-Tenant Isolation**: Every business is strictly isolated at the database level using **PostgreSQL Row Level Security (RLS)**. Data access is governed by authenticated business membership, ensuring zero cross-tenant leakage.
- **High-Performance Authorization**: Utilizes JWT-based session management with Supabase Auth, providing O(1) latency for authorization checks.
- **Relational Integrity**: Built on **PostgreSQL**, ensuring transactional consistency for all financial records, inventory movements, and payroll executions.
- **Atomic Provisioning**: Business setup and onboarding are handled via **Next.js Server Actions** and **SQL Transactions** to guarantee data consistency during tenant initialization.

---

## 🛠 Core Modules

- **Adaptive Business Intelligence**: UI reconfigures based on sector (Retail, Consulting, or Hybrid).
- **AI-Powered HR Suite**:
    - **Smart Onboarding**: Automated hire integration with AI-generated documents.
    - **Exit & Termination**: Professional offboarding with AI-drafted notices.
    - **Payroll Engine**: Automated gross-to-net with Maker-Checker approval and statutory logic (PAYE, Pension, NHF).
- **Digital Storefront**: Integrated presence with **WhatsApp Business Checkout**.
- **Unified Inventory**: Real-time stock tracking with low-stock intelligence.
- **Financial Integrity**: Full double-entry bookkeeping with automated Chart of Accounts and Trial Balance.
- **AI Business Consultant**: Context-aware insights powered by Gemini 2.0 via Google Genkit.

---

## 🛠 Tech Stack

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **Backend**: [Supabase](https://supabase.com/) (Auth, PostgreSQL, RLS, Storage)
- **UI Components**: [Shadcn UI](https://ui.shadcn.com/) / [Radix UI](https://www.radix-ui.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **AI Engine**: [Google Genkit](https://firebase.google.com/docs/genkit) with Gemini 2.0 Flash
- **Data Export**: jsPDF & XLSX

---

## 📦 Deployment & Environment

### Environment Setup
1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/cacu-tech/solution.git
    cd solution
    ```
2.  **Configure Supabase**:
    - Create a Supabase Project.
    - Run the schema migration found in `docs/supabase_schema.sql`.
    - Enable Email/Password and Google Auth providers.
3.  **Environment Variables**:
    Create a `.env.local` file with your credentials:
    ```env
    NEXT_PUBLIC_SUPABASE_URL=your-project-url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
    GEMINI_API_KEY=your-gemini-key
    ```
4.  **Run Development**:
    ```bash
    npm install
    npm run dev
    ```

---

© 2024 CACU Technologies Limited. All rights reserved.
