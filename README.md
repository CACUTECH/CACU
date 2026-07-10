# CACU Business Management Platform

CACU Technologies Limited provides a unified ERP solution designed to empower Nigerian MSMEs. This platform dynamically adapts to support **Product-based**, **Service-based**, and **Hybrid** business models from a single, configurable architecture.

---

## 🚀 Core Features

- **Adaptive Business Intelligence**: The UI reconfigures itself based on your business type (Retail, Consulting, or Hybrid).
- **Unified Catalog**: Manage goods with inventory tracking alongside billable services with duration and staff assignments.
- **Job & Work Order Module**: Professional service delivery workflows from quotation to completion.
- **Financial Integrity**: Full double-entry bookkeeping with automated Chart of Accounts, Journal Entries, and Trial Balance.
- **AI Business Consultant**: Context-aware insights powered by Gemini 2.0 to help optimize cash flow and growth.
- **Digital Storefront**: Integrated online presence to reach customers directly.

---

## 🛠 Tech Stack

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **UI Components**: [Shadcn UI](https://ui.shadcn.com/) / [Radix UI](https://www.radix-ui.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **AI Engine**: [Genkit](https://firebase.google.com/docs/genkit) with Gemini 2.0
- **State Management**: React Hooks & Context API
- **Data Export**: jsPDF (PDF) & XLSX (Excel)

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

## 📂 Project Structure

- `src/app/`: App Router pages and layouts.
- `src/components/`: Reusable UI components (Shadcn).
- `src/ai/`: Genkit flows and prompts for business insights.
- `src/lib/`: Shared data models, types, and utility functions.
- `docs/`: Technical specifications and database IR files.

---

© 2024 CACU Technologies Limited. All rights reserved.