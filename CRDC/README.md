# CRDC — Center for Research, Development & Consulting Platform

English | العربية

## 1. Project Overview

The **CRDC Platform** is a full-stack digital prototype for the Consultancy, Research and Development Center (CRDC) at Sadat Academy for Management Sciences.

The platform centralizes the center's research services, researcher onboarding, administrative case management, cashier payment receipt verification, and performance analytics into one secure web application.

**Important:** This is a zero-budget training and demonstration initiative. No real researcher personal data is stored in this repository, and no modifications are made to the official Academy website during this phase.

## 2. Current Project Status

- **Stage:** Functional Operational Prototype (Rounds 1–5 Completed & Verified via CI).
- **Completed Modules:**
  - **Database & Security (`supabase/`):** 15-table PostgreSQL schema (`crdc`), strict Row-Level Security (RLS), `SECURITY DEFINER` RPC workflows, serialized last-admin guard, and append-only `crdc.audit_log`.
  - **Researcher Portal (`CRDC/researcher-portal/`):** Registration & password recovery, Egyptian National ID / foreign passport validation, safe profile editing, service catalog with automated EGP/USD fee calculation, separate thesis/paper requests, and payment receipt upload.
  - **Staff, Admin & Cashier Console:** Server-side keyset-paginated request queue, staff assignment with conflict-of-interest checks, journal publication decisions, aggregate viewer metrics, and a dedicated Cashier workspace for verifying and approving/rejecting payment receipts.
  - **Automated CI/CD (`.github/workflows/`):** Automated `pgTAP` database security tests (200+ assertions), Vite production build checks, and Playwright end-to-end browser tests.
- **Remaining Milestones:**
  - Enhanced Analytics & KPIs Dashboard visualizations.
  - Integrating the `CRDC/RAG` assistant into the Researcher Portal.

## 3. Approved Technology Stack

| Component | Implemented Technology |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite (RTL Arabic-first responsive UI) |
| **Backend & Database** | Supabase (PostgreSQL, Auth, Private Storage, RLS, RPCs) |
| **Testing & CI/CD** | GitHub Actions, `pgTAP` (`supabase test db`), Playwright E2E |
| **Chatbot / RAG** | Python (`CRDC/RAG/`) |
| **Version Control** | Git / GitHub (PR-based workflow with mandatory CI checks) |

## 4. Actual Repository Structure

```text
sams-command-center/
├── CRDC/
│   ├── researcher-portal/       # React + TypeScript + Vite portal & Playwright E2E tests
│   │   ├── src/                 # ResearcherPortal, StaffConsole, Auth & error mapping
│   │   └── e2e/                 # Automated end-to-end browser test suites
│   ├── RAG/                     # Retrieval-Augmented Generation knowledge base & index
│   ├── docs/database/           # Database schema, decisions, and RLS documentation
│   ├── README.md                # English project documentation
│   └── README.ar.md             # Arabic project documentation
├── supabase/
│   ├── migrations/              # Timestamped PostgreSQL migrations (Schema, RLS, RPCs, Audit)
│   ├── tests/                   # pgTAP database & security test suites
│   ├── scripts/seed_local.sh    # Guarded local-only synthetic data loader
│   ├── seed.sql                 # Synthetic dataset generator (400 test researchers)
│   └── config.toml              # Local Supabase stack configuration
└── .github/workflows/           # Automated CI pipelines (SQL, Build, E2E)
```

## 5. Roles & Security Model

- **Researcher:** Creates profile once, edits non-identity fields, submits thesis/paper service requests, uploads payment receipts, and tracks item status timelines.
- **Reviewer / Statistician:** Processes assigned items and updates workflow statuses.
- **Cashier:** Reviews payment orders, downloads uploaded receipt proofs from private storage, and approves or rejects payments via audited RPCs (National IDs and passport numbers are masked).
- **Viewer:** Views aggregate dashboard metrics without access to researcher PII.
- **Admin:** Full operational oversight, staff assignment, role management (protected by a last-admin guard), and read-only access to `crdc.audit_log`.

## 6. Team Structure & Responsibilities

- **Team Leader — Baher:** Overall coordination, architecture & security supervision, PR reviews & merging, CI/CD pipelines, and documentation.
- **Platform Development Team (Salma, Samar, Omar):** Researcher Portal, Staff & Cashier Consoles, Supabase schema, RLS policies, RPCs, and testing.
- **Dashboard & KPIs (Menna):** Executive KPIs, dashboard visualizations, and performance analytics.
- **Chatbot Team (Hager, Nada, Alaa):** Knowledge base preparation, RAG retrieval pipeline (`CRDC/RAG`), and portal chatbot integration.

## 7. Local Development & Testing

1. **Start local Supabase stack & apply migrations:**
   ```bash
   npx supabase start
   npx supabase db reset
   ```
2. **Run database security tests (`pgTAP`):**
   ```bash
   npx supabase test db
   ```
3. **Run the frontend portal:**
   ```bash
   cd CRDC/researcher-portal
   npm install
   npm run dev
   ```
