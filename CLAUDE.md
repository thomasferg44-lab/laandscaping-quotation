# CLAUDE.md

This file is read automatically by Claude Code at the start of every session in this repo. It is the source of truth for how this project is built. Follow it over any conflicting default behavior.

## Project

**Name:** DropStack Quote & Invoice Tool (landscaping vertical)
**Owner:** Thomas — DropStack (white-label SaaS agency)
**Purpose:** A white-label quote-to-invoice tool for South African landscaping businesses. One deploy per client (not multi-tenant). The landscaper's customer never touches a login — they view a hosted quote link, accept it, and can pay/download from the same page.

This is the first tool in DropStack's landscaping vertical. It will be white-labelled and re-deployed per client the same way the existing Quote & Invoice Generator (Cayman Aqualife Academy) and Smart Booking Tool (swim.dropstack.co) were.

## Tech stack (match existing DropStack tools — do not introduce new tooling without asking)

- **Frontend:** React + Vite
- **Styling:** Tailwind CSS (utility classes only, no CSS-in-JS)
- **PDF generation:** jsPDF, client-side
- **Backend/data:** Supabase (Postgres + Storage for photos)
- **Serverless functions:** Netlify Functions (for anything that needs a server — status webhooks, future Resend email sending, future payment webhooks)
- **Hosting:** Netlify
- **Transactional email (fast-follow, not v1):** Resend, same pattern as other DropStack tools (sender: quotes@<clientdomain>)
- **White-labelling:** `companyConfig.js` at the project root — same pattern as the existing Quote & Invoice Generator. Every client deploy is this same repo with a different companyConfig.js and different Supabase project (or a shared Supabase project with a client_id scoping every row — see Data Model below, decide before scaffolding).

## Non-negotiable workflow rules

- **Never push directly to main.** Every change is a branch + PR, no exceptions, even for small fixes. This matches how all other DropStack projects are run.
- **Do not deploy.** Thomas handles all outward-facing steps himself: real Netlify deploys, real domain/DNS changes, and live end-to-end tests with real phone numbers/emails. Claude Code should prepare everything so a deploy is a one-command action, but should not trigger the deploy itself or claim something is "live."
- **Do not send real messages during development.** Any WhatsApp (`wa.me`) or email (`mailto:`) links should be built and testable, but do not fire real sends to real numbers/addresses as part of automated testing. Use obviously fake test data (e.g. `+27000000000`, `test@example.com`) in any test scripts.
- **Ask before adding a new dependency.** Keep the stack lean — this is meant to be cheap to run and easy for Thomas to maintain solo across many client deploys.
- **Ask before touching env vars / secrets.** Never hardcode API keys, Supabase keys, or client-specific data (phone numbers, business names) directly in committed code. Everything client-specific lives in `companyConfig.js` (non-secret) or `.env` (secret, gitignored).

## Product spec

### Core flow
1. Landscaper (the client — e.g. a garden service owner) logs into a simple dashboard and builds a quote: line items, each optionally with a photo, using trade-specific input helpers (see below).
2. Quote saves to Supabase with status `draft`.
3. Landscaper sends the quote to their customer via one of three buttons: **WhatsApp**, **Email**, or **Copy link**. All three point at the same hosted quote URL. Status flips to `sent`.
4. Customer opens the link (no login) → status flips to `viewed` (first view only, don't re-trigger on every reload).
5. Customer taps **Accept** on the page → status flips to `accepted`. Landscaper is notified (v1: they see it on their dashboard; fast-follow: a notification).
6. Landscaper taps **Convert to Invoice** on their dashboard → same underlying record, status flips to `invoiced`. No re-entry of data — it's the same line items, now framed as an invoice.
7. PDF download is available at every stage (draft through invoiced) via jsPDF, generated client-side from the record.
8. (Fast-follow, not v1): payment button (PayFast/Yoco) on the invoice view, and status flips to `paid` on webhook confirmation. Scaffold the status enum to include `paid` now even though the payment integration isn't built yet — don't leave a gap that requires a schema migration later.

### Trade-specific input helpers (this is a differentiator — don't skip it)
When adding a line item, offer quick-entry modes in addition to a plain description + amount:
- **Area-based:** m² × rate per m² (for lawn, paving, turf)
- **Per-unit:** quantity × rate per unit (for plants, pavers, fixtures)
- **Per-load:** number of loads × rate per load (for soil, compost, mulch, rubble removal)
- **Day-rate labour:** number of days × day rate
- Whichever mode is used, the result collapses to a single line item with a description and a total — the mode is just a calculator UI on top of that, it does not change the data model.

### Photos on line items
Each line item can optionally have one photo attached (e.g. "remove dead tree" + photo of the tree). Store in Supabase Storage, save the public URL on the line item. Show as a thumbnail in the builder and on the hosted quote page.

### Deposit / progress billing (fast-follow, not v1, but keep in mind)
Eventually a toggle to split an invoice into a deposit (e.g. 50% now) and a balance (on completion), generating two linked records. Don't build this now — just don't design the schema in a way that makes it hard to add later (i.e., allow an invoice to optionally reference a `parent_quote_id` and a `portion` field).

## Data model (Supabase)

Single Supabase project can serve multiple client deploys if every table is scoped by `client_id` — decide with Thomas before scaffolding whether v1 is one Supabase project per client (simplest, matches "one deploy per client" philosophy) or one shared project scoped by `client_id`. Default assumption below is **one Supabase project per client deploy** (simplest, no cross-client data risk, matches the one-deploy-per-client decision already made) — confirm this before writing migrations.

```sql
-- quotes table (also serves as the invoice once status advances — same record)
create table quotes (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text,        -- for the WhatsApp share link
  customer_email text,        -- for the mailto share link
  line_items jsonb not null default '[]', 
    -- array of: { id, description, mode ('plain'|'area'|'unit'|'load'|'day'), 
    --            qty, rate, total, photo_url (nullable) }
  subtotal numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft',
    -- 'draft' | 'sent' | 'viewed' | 'accepted' | 'invoiced' | 'paid'
  parent_quote_id uuid references quotes(id), -- nullable, for future deposit/balance split
  portion text,  -- nullable, e.g. 'deposit' | 'balance' | null for a normal full quote
  viewed_at timestamptz,
  accepted_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row Level Security: the hosted public quote page reads via an anon key
-- scoped to SELECT + UPDATE (for status only) on a single row by id.
-- The landscaper's dashboard reads/writes via an authenticated session.
-- Claude Code: write explicit RLS policies, do not leave the table open.
```

## companyConfig.js shape

```js
export const companyConfig = {
  businessName: "Example Landscaping",
  logoUrl: "/logo.png",
  primaryColor: "#2F5233",
  accentColor: "#8B6F47",
  currency: "ZAR",
  whatsappNumber: "27821234567", // landscaper's own number, used in the
                                   // pre-filled wa.me message as the sender context
  contactEmail: "quotes@examplelandscaping.co.za",
  paymentMethods: [], // e.g. ['payfast'] once wired — empty in v1
};
```

## Build order (follow this sequence — don't jump ahead)

1. Supabase schema + RLS policies
2. Quote builder form (line items with the four input modes + photo upload)
3. Hosted public quote page (read-only render + Accept button + status transition)
4. Three share buttons (WhatsApp `wa.me`, Email `mailto:`, Copy link) — all pre-filled with a message referencing `companyConfig.businessName` and the quote link
5. Convert-to-invoice action + jsPDF export (available at every status)
6. Landscaper dashboard: list of quotes with status, filter/sort by status
7. (Stop here for v1. Do not build payment integration, Resend email sending, or deposit/balance splitting unless explicitly asked.)

## Definition of done for v1

- A landscaper can build a quote with photo line items, using at least the area and per-unit input modes.
- The quote has a working hosted URL that renders correctly on mobile (this will mostly be opened on phones via WhatsApp).
- All three share buttons produce correct, working links with real dynamic data (not placeholder text).
- The customer can accept, and the status visibly changes on the landscaper's dashboard without a manual refresh being required to eventually reflect it (polling or Supabase realtime — Claude Code's choice, note the tradeoff).
- Convert-to-invoice works and produces the same document reframed as an invoice.
- PDF export works and matches the on-screen quote.
- No hardcoded client data anywhere outside `companyConfig.js`.
- RLS policies actually restrict access — test that the public page cannot read/write other quotes by guessing IDs beyond the one it's given.

## What NOT to do

- Don't build multi-tenancy — this is one deploy per client.
- Don't build payment, deposit-splitting, or automated email sending in v1.
- Don't invent a design system — use clean, minimal Tailwind, mobile-first, and pull colors from `companyConfig.js`.
- Don't add authentication complexity for the landscaper's dashboard beyond Supabase Auth's simplest email/password or magic-link flow — this is a single-user-per-deploy tool, not a team product.
- Don't deploy, and don't claim something is deployed/live.
