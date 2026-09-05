# DropStack Quote & Invoice Tool — Landscaping

A white-label, single-tenant quote-to-invoice tool built for South African landscaping and garden service businesses. Part of the DropStack product suite.

## What this is

Landscapers spend a lot of time on quotes that go nowhere and no time knowing whether a client even saw them. This tool replaces "build a PDF, find the client's number/email, attach it, send it, and hope" with a single hosted link that:

- Shows the client a clean, branded quote on their phone
- Lets them accept it with one tap
- Turns into an invoice with one tap on the landscaper's side, no re-entry
- Can be sent by WhatsApp or Email, landscaper's choice, from their own number/address
- Still produces a downloadable PDF at every stage, for anyone who wants a formal copy

## Why it's different from Jobber / ServiceM8 / Service Fusion / etc.

Those tools are global, USD/GBP-priced, feature-heavy platforms built around US/AU field-service workflows. This tool is:
- ZAR-native
- WhatsApp-native (SA's dominant messaging channel — those tools are email-first)
- Priced and scoped for a two-person garden service, not an enterprise field-service team
- White-labelled to look like the landscaper's own system, not a DropStack product

## Tech stack

- React + Vite (frontend)
- Tailwind CSS (styling)
- Supabase (database + photo storage + auth)
- jsPDF (PDF export, client-side)
- Netlify (hosting + serverless functions)
- Resend (transactional email — fast-follow, not in v1)

## Project structure (expected — Claude Code will scaffold this)

```
/src
  /components       -- shared UI: LineItemRow, ShareButtons, StatusBadge, etc.
  /pages
    Builder.jsx      -- landscaper's quote builder
    Dashboard.jsx    -- landscaper's list of quotes, filterable by status
    PublicQuote.jsx  -- the hosted, read-only, no-login quote page
  /lib
    supabaseClient.js
    pdfExport.js
    shareLinks.js    -- builds the wa.me and mailto URLs
  companyConfig.js    -- per-client white-label config (see CLAUDE.md for shape)
/supabase
  schema.sql          -- table + RLS policy definitions
/netlify/functions     -- reserved for future payment webhooks / Resend sending
```

## Local setup

1. Clone this repo (or the client-specific fork of it)
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your Supabase project URL + anon key
4. Edit `companyConfig.js` with the client's business name, colors, logo, WhatsApp number, and contact email
5. Run the Supabase schema: paste `/supabase/schema.sql` into the Supabase SQL editor for this client's project (creates the `quotes` table, RLS policies, triggers, and the `quote-photos` storage bucket). The file is idempotent, so re-pasting it after a schema change is safe. Files in `/supabase/patches` are incremental changes for projects already set up.
6. Create the landscaper's login: Supabase dashboard → Authentication → Users → Add user (email + password). There is no signup screen by design; one user per deploy.
7. `npm run dev` and sign in at `/login`. You land on the dashboard; the header shows "● live" once Realtime is connected, or "○ polling" (20s) if the table isn't in the `supabase_realtime` publication yet (schema.sql adds it).

## Deploying a new client

This is a one-deploy-per-client tool. To spin up a new landscaping client:

1. Fork/copy this repo (or create a new branch and swap config — decide per Thomas's preferred repo strategy)
2. New Supabase project for this client (keeps client data fully isolated)
3. New `companyConfig.js` values
4. New Netlify site, connected to the client's copy of the repo
5. Custom domain or `<client>.dropstack.co` subdomain, DNS via Namecheap → Netlify (same pattern as other DropStack sites)
6. Resend sender domain, if/when email sending (not mailto) is added

## Status

**v1 in progress.** See `CLAUDE.md` for the full spec and build order. Payment integration (PayFast/Yoco), automated invoice reminders, and deposit/balance splitting are intentionally out of scope for v1.

## Roadmap (post-v1)

- PayFast/Yoco payment button on invoices, with `paid` status flip on webhook
- Resend-powered branded email sending (upgrade from `mailto:`)
- Automated "invoice still outstanding" reminders
- Deposit + balance progress billing
- Recurring maintenance scheduling (separate tool, shares this data model)
