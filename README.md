# CACU Business Management Platform

CACU Technologies Limited provides a unified ERP solution designed to empower Nigerian MSMEs. This platform dynamically adapts to support **Product-based**, **Service-based**, and **Hybrid** business models from a single, configurable architecture.

---

## 🚀 Core Features

- **Adaptive Business Intelligence**: The UI reconfigures itself based on your business type (Retail, Consulting, or Hybrid).
- **AI-Powered HR Suite**:
    - **Smart Onboarding**: Automated new hire integration with AI-generated offer letters and contracts.
    - **Exit & Termination**: Professional offboarding with AI-drafted resignation acceptances and service certificates.
    - **Payroll Engine**: Automated gross-to-net processing with built-in validation and variance analysis.
- **Digital Storefront**: Integrated online presence with **WhatsApp Business Checkout** to reach customers directly.
- **Unified Inventory**: Manage physical goods alongside billable services with duration and staff assignments.
- **Job & Work Order Module**: Professional service delivery workflows from quotation to completion.
- **Financial Integrity**: Full double-entry bookkeeping with automated Chart of Accounts, Journal Entries, and Trial Balance.
- **AI Business Consultant**: Context-aware insights powered by Gemini 2.0 via Google Genkit.
- **Community Hub**: Connect with fellow entrepreneurs and get real-time alerts on SME grants and funding.

---

## 🛠 Developer Resources

If you are looking to port this application to a mobile platform or recreate the logic in a new environment, please refer to our master blueprint:
- [**Master Developer Prompt**](./docs/MASTER_DEVELOPER_PROMPT.md) - A comprehensive guide for AI-driven development.

---

## 🛠 Tech Stack

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **UI Components**: [Shadcn UI](https://ui.shadcn.com/) / [Radix UI](https://www.radix-ui.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **AI Engine**: [Google Genkit](https://firebase.google.com/docs/genkit) with Gemini 2.0 Flash
- **Data Export**: jsPDF (PDF) & XLSX (Excel)
- **State Management**: React Hooks & Context API

---

## 📦 Deployment Guide

### Phase 1: MVP (Vercel + Supabase)
For rapid prototyping and low-cost entry, we recommend the following stack:

1.  **Database (Supabase)**:
    - Create a new project at [supabase.com](https://supabase.com/).
    - Run the provided SQL migrations to set up tables for `Catalog`, `Jobs`, `Transactions`, and `Customers`.
    - Copy the `SUPABASE_URL` and `SUPABASE_ANON_KEY` to your `.env` file.
2.  **Hosting (Vercel)**:
    - Connect your GitHub repository to [Vercel](https://vercel.com/).
    - Configure environment variables (`GEMINI_API_KEY`, `SUPABASE_URL`, etc.).
    - Deploy. Vercel's edge functions will handle the Next.js App Router and Genkit flows.

### Phase 2: Scale (Firebase / AWS)
As your user base grows, migrate to a more robust infrastructure:

- **Auth & Storage**: Transition to [Firebase Authentication](https://firebase.google.com/docs/auth) and [Cloud Storage](https://firebase.google.com/docs/storage) for production-grade security and asset handling.
- **Global Payouts**: Integrate [Sterling Bank API](https://sterling.ng/) or [Access Bank](https://www.accessbankplc.com/) for automated settlement.
- **Orchestration**: Deploy to [Firebase App Hosting](https://firebase.google.com/docs/app-hosting) or AWS Amplify for managed scalability.

---

## 🛠 Getting Started

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/cacu-tech/solution.git
    cd solution
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Run Development Server**:
    ```bash
    npm run dev
    ```
4.  **Initial Setup**:
    Navigate to `/setup` to run the Business Configuration Wizard and choose your operating mode.

---

© 2024 CACU Technologies Limited. All rights reserved.