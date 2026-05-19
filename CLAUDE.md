# Sotara PO System — Claude Context

## What This Is

A finance invoice approval system for Sotara. Emails arrive at a Microsoft 365 finance mailbox → AI reads and classifies them → real invoices get a Purchase Order created → finance reviews and edits → an approver approves via email link → a CSV export is generated for the accounting system.

Replaces a manual Excel-based process.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Database / Auth / Storage / Edge Functions | Supabase (Postgres, Auth, Storage, Deno Edge Functions) |
| Frontend | React 18 + Vite + TypeScript |
| AI Extraction | Google Gemini 2.5 Pro |
| Email source | Microsoft 365 via MS Graph API |
| Identity | Azure Active Directory (OIDC → Supabase Auth) |
| Accounting export | CSV (Sage 200 format) |

**Supabase project ref:** `alcfqmolvnjnmylopsgb`

---

## Mac Setup

### 1. Install Claude Code
```bash
npm install -g @anthropic/claude-code
claude  # authenticate with your Anthropic account
```

### 2. Clone and open
```bash
git clone https://github.com/<org>/POSYSTEM.git
cd POSYSTEM
claude
```

### 3. Install frontend dependencies
```bash
cd frontend
npm install
npm run dev   # runs on http://localhost:5173
```

### 4. Connect the Supabase MCP

Add this to your Claude Code settings. Run inside Claude Code:
```
/mcp add supabase
```
Or manually add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        "YOUR_SUPABASE_PERSONAL_ACCESS_TOKEN"
      ]
    }
  }
}
```
Get your personal access token from: https://supabase.com/dashboard/account/tokens

---

## Supabase Secrets Already Configured (Edge Functions)

These secrets are set on the live project — you don't need to set them again:
- `GEMINI_API_KEY`
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `FINANCE_MAILBOX`
- `FRONTEND_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## Repo Structure

```
POSYSTEM/
├── supabase/
│   ├── migrations/          # 001–006: schema, enums, RLS, indexes, triggers
│   └── functions/
│       ├── _shared/         # cors.ts, supabase-client.ts, gemini-client.ts
│       ├── email-intake/    # Polls M365 mailbox, classifies emails with Gemini
│       ├── gemini-processor/# Downloads invoice, extracts fields with Gemini
│       ├── send-approval/   # NOT YET BUILT
│       ├── process-approval/# NOT YET BUILT
│       ├── generate-csv/    # NOT YET BUILT
│       ├── reminder-scheduler/ # NOT YET BUILT
│       └── sync-approvers/  # NOT YET BUILT
└── frontend/
    └── src/
        ├── pages/
        │   ├── Login.tsx
        │   ├── FinanceDashboard.tsx
        │   ├── InvoiceReview.tsx
        │   ├── ApproverView.tsx
        │   ├── ExportManagement.tsx
        │   ├── AuditTrailViewer.tsx
        │   └── AdminPanel.tsx
        ├── components/
        │   └── layout/      # AppShell, Sidebar, TopBar (glassmorphism design)
        └── lib/
            ├── supabase.ts
            └── auth.ts
```

---

## What's Built

### Edge Functions (deployed)
- **`email-intake`** (v15) — polls mailbox every trigger, uses Gemini to classify each email (new invoice / payment reminder / statement / spam etc.), detects duplicate attachments, creates POs only for genuine new invoices, logs reminders against existing POs
- **`gemini-processor`** (v24) — downloads invoice from Storage, sends to Gemini 2.5 Pro for field extraction (supplier, amounts, dates, references), stores immutable OCR record, pre-populates PO fields

### Frontend
- Glassmorphism / prism light aesthetic throughout
- Dark / light mode toggle in the top bar
- Login page (Azure AD SSO)
- Finance Dashboard (PO list with status filters)
- Invoice Review page (PDF viewer + editable form + OCR comparison)
- Admin Panel (user management, approver GAL search)

---

## What Still Needs Building

### Edge Functions (not yet built)

**`send-approval`**
- Triggered when finance changes PO status to `pending_approval`
- Fetches PO + approver details
- Sends HTML email via MS Graph with Approve / Reject / Forward buttons
- Updates `purchase_orders.approval_sent_at`
- Logs `approval_sent` to audit_log

**`process-approval`**
- Called from the ApproverView frontend page
- Validates caller is the assigned approver
- Approve → status `approved`, sets `approved_by_id`, `approved_at`
- Reject → status `rejected`, requires `rejected_reason`
- Forward → updates `assigned_approver_id`, re-triggers `send-approval`
- Logs all outcomes to audit_log

**`generate-csv`**
- Validates: net + vat = gross; nominal lines sum = net; all required fields present
- Generates CSV in exact Sage 200 column order (see plan for full column list)
- Uploads to `csv-exports` Storage bucket
- Updates exported POs to status `exported`
- Logs `exported` to audit_log for each PO

**`reminder-scheduler`**
- Daily cron at 08:00
- Finds POs with `pending_approval` status where `approval_sent_at` is older than 3 days
- Sends reminder email via MS Graph
- Inserts into `reminders` table
- Logs `reminder_sent` to audit_log

**`sync-approvers`**
- Manual trigger or daily cron
- Calls MS Graph `GET /v1.0/users` to get all Azure AD users
- Upserts into `approvers` table on `azure_oid`
- Marks missing users as `is_active = false`

### Frontend Pages (need work)
- **ApproverView** — read-only PDF + summary + Approve/Reject/Forward buttons
- **ExportManagement** — select approved POs, generate CSV, download history
- **AuditTrailViewer** — immutable event timeline for a PO

---

## Database Key Tables

| Table | Purpose |
|---|---|
| `purchase_orders` | Central record — all PO fields, status, approval tracking |
| `invoice_files` | File metadata for uploaded invoices |
| `ocr_extractions` | Immutable Gemini extraction results |
| `nominal_lines` | Up to 2 nominal ledger lines per PO |
| `vat_lines` | Up to 2 VAT analysis lines per PO |
| `audit_log` | Insert-only event trail (no updates/deletes ever) |
| `approvers` | Azure AD users who can approve POs |
| `profiles` | Supabase Auth users (finance, admin, auditor roles) |
| `csv_exports` | Record of generated CSV exports |
| `reminders` | Tracks approval reminder emails sent |

---

## Important Rules

- **`ocr_extractions` is immutable** — never update or delete rows, only insert
- **`audit_log` is immutable** — RLS blocks updates and deletes
- **Description field max 75 chars** — enforced at DB level and in UI
- **Amounts stored as NUMERIC(15,2)** — no currency symbols, 2 decimal places in CSV
- **CSV dates in DD/MM/YYYY format**
- **Empty CSV fields must be blank string** — never "null" or NULL
- **Edge Functions deployed via MCP must be self-contained** — do NOT use `../_shared/` imports, inline all shared code into the function file. The MCP bundler cannot resolve parent-directory paths.

---

## Design System

The UI uses a glassmorphism + prism light aesthetic with CSS custom properties defined in `frontend/src/styles/tokens.css`. Key variables:
- `--accent`: `#00b4d8` (primary cyan)
- `--accent-2`: `#06d6a0` (teal)
- `--accent-3`: `#7b61ff` (purple)
- `--glass`: `rgba(255,255,255,0.06)` glass surface
- `--prism-gradient`: 4-colour prismatic gradient

Light and dark themes are toggled via `data-theme="dark"` on `document.documentElement`.

---

## Running Locally

```bash
# Frontend dev server
cd frontend && npm run dev

# The Edge Functions run on Supabase cloud — no local function runner needed
# Test them directly from the Supabase dashboard > Edge Functions > [name] > Test
```
