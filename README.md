# CACU Business Management Platform

CACU Technologies Limited provides a unified ERP solution designed to empower Nigerian MSMEs. This platform dynamically adapts to support **Product-based**, **Service-based**, and **Hybrid** business models from a single, high-performance architecture.

---

## 🚀 Production-Ready Architecture

The platform has been engineered for extreme scalability and security, capable of supporting **1 million+ consumer users** with a multi-tenant cloud backend.

### 🛡️ Security & Scalability Features (P0 Remittance)
- **Multi-Tenant Isolation**: Every business is strictly isolated at the database level. Security rules ensure that users can never access data from another organization.
- **High-Performance Authorization**: Uses **Firebase Custom Claims** for role-based access control (RBAC), eliminating expensive database lookups and ensuring O(1) latency.
- **Abuse Protection**: Integrated with **Firebase App Check** (reCAPTCHA Enterprise) to block unauthorized bot traffic and prevent "Denial of Wallet" attacks.
- **Identity Integrity**: Mandatory **Email Verification** and strict session management via Firebase Authentication.
- **Atomic Provisioning**: Business setup logic is handled via **Server Actions** and **Firestore Batch Writes** to ensure data consistency.

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
- **Backend**: [Firebase](https://firebase.google.com/) (Auth, Firestore, App Check)
- **UI Components**: [Shadcn UI](https://ui.shadcn.com/) / [Radix UI](https://www.radix-ui.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **AI Engine**: [Google Genkit](https://firebase.google.com/docs/genkit) with Gemini 2.0 Flash
- **Data Export**: jsPDF & XLSX

---

## 📦 Deployment & Environment

### Security Audits
For a deep dive into the security posture and remediation roadmap for high-scale deployment, refer to:
- [**Production Readiness Checklist**](./docs/PRODUCTION_CHECKLIST.md)
- [**Master Developer Prompt**](./docs/MASTER_DEVELOPER_PROMPT.md)

### Environment Setup
1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/cacu-tech/solution.git
    cd solution
    ```
2.  **Configure Firebase**:
    - Create a Firebase Project.
    - Enable Authentication (Email/Password & Google).
    - Provision Cloud Firestore in Native Mode.
    - Configure App Check with reCAPTCHA Enterprise.
3.  **Environment Variables**:
    Create a `.env.local` file with your Firebase config and Gemini API key.
4.  **Run Development**:
    ```bash
    npm install
    npm run dev
    ```

---

© 2024 CACU Technologies Limited. All rights reserved.
