# REPORT: Quote & Invoice compete pass (reskin + functional upgrades)

Branch `compete/quote-upgrades` (10 commits on `main` c7b3ff5), including Tom's two mid-build addenda (see the Addenda section). **Deployed 8–9 November 2026 on Tom's approval (DEPLOY_TASK.md)**; see the Deployment section right below. Before that approval, this pass ran with no push, no deploy and no live database writes. No SQL was applied by me at any point: the schema patch was already on dropstack-dev (Nov 6, per DEPLOY_TASK), and I only verified it with read-only probes.

Format follows `dropstack-tools-DESIGN.md` §6: baseline → what changed → Gate 1 → Gate 2 → Gate 3 → review pack → Gate 5 → behaviour changes and what's left.

---

## Deployment (8–9 November 2026)

| Step | Result |
|---|---|
| Database state before deploy | Patch already applied Nov 6 (per DEPLOY_TASK, verify-compete 24/24 there). **Not re-applied.** Six read-only anon probes against dropstack-dev all **PASS**: `get_public_quote` returns the new columns; `accept_public_quote_v2` is exposed (malformed token returns `not_found`, no row touched); the old `accept_public_quote(token)` is still exposed; internal `accept_quote_as_customer` is denied to anon (42501); `quote_library_items` exists and is denied to anon (42501); `quotes` is still denied to anon (42501). |
| Push | Branch `compete/quote-upgrades` pushed to `origin` at **38eba5e63d446a69b85a9a4ad937f09a2951755d** |
| PR | https://github.com/thomasferg44-lab/laandscaping-quotation/pull/1, merged into `main` as **b27441c94341f146aacffc5ad26b957bd0105c58** (merge commit; no direct push to main) |
| Deploy route | Same as previous deploys: Netlify site `quotetoolv2` builds `main` from GitHub (`npm run build` → `dist`). `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` were already set on Netlify for builds and functions; nothing in Netlify was changed. |
| Deploy preview (checked before merging) | `6af1277a3b81b1d7be502c2a` at https://deploy-preview-1--quotetoolv2.netlify.app: live checks 9/9 PASS |
| **Production deploy** | **`6af127e0bf13a479b58762dd`**, state `ready`, context `production`, branch `main`, commit b27441c, published 2026-11-09 01:54:56 UTC, function `health` deployed. Admin: https://app.netlify.com/projects/quotetoolv2/deploys/6af127e0bf13a479b58762dd |

**Live verification on https://quote.dropstack.co** (read-only: no sign-in, no real quote links opened, since a first open marks a quote viewed; the only quote token used is the all-zero one, which matches nothing). 9/9 PASS:

| Check | Result |
|---|---|
| `index.html` is the new build (brand title, Supabase preconnect, early quote fetch) | PASS |
| Served JS contains the new features: options ("Choose an option"), add-ons, deposit, typed-name acceptance ("Your full name", `accept_public_quote_v2`), "Load demo data", library, Quick add suggestions, `/api/health` | PASS |
| `GET /api/health`: `ok: true`, `healthy: true`, `database: true` (537 ms), `configComplete: true`, booleans only, `no-store`, no URL/key/number/email in the body | PASS |
| Customer page (390px and desktop) renders the new designed "Quote not available" state | PASS |
| Sign-in (390px and desktop) renders in the new design | PASS |
| No JS errors and no database write requests during the checks, at both sizes | PASS |

Health also reports `whatsappNumber: false` and `contactEmail: false`. That is correct for this deploy, which runs the deliberately fake placeholder business, so the dashboard status line will read "Connected · add WhatsApp number" until a real client config is used.

What I did **not** verify live, because each needs either a login or opening a real quote (both are writes, or need credentials Tom holds): the signed-in dashboard (including the demo data button rendering), and building, accepting and invoicing a quote end to end. The steps are in the BLOCKED list below (now: run on live with a test login and test data).

**Live issue found, not fixed (Tom's call): a "Powered by Netlify" badge is shown on quote.dropstack.co.** Netlify injects it at serve time (`/.netlify/scripts/hud?variant=public`); our built `index.html` contains no Netlify reference. The design spec bans it (§2A). Removing it is a Netlify site or plan setting, which was outside this deploy task, so I changed nothing in Netlify.

## How it was tested (read this first)

The local `.env` points at the shared `dropstack-dev` database, which serves the live quote.dropstack.co. Opening a quote link there would flip it to "viewed", which is a write. So **no browser run touched any network beyond localhost**:

- **Browser flows (Gates 0, 2, 3, 4, 5)** ran against the real production build compiled with a local in-memory test backend (`VITE_MOCK_BACKEND=1`, `src/dev/mockBackend.js`). Every request to any other host was blocked, and each run asserts "no request left the local server". The test backend copies the access model (anon has RPCs only, owner or allowlist RLS, the status trigger) and uses the same pure functions as the app. It is compiled out of normal builds; I checked that the production bundle contains no trace of it. **A pass here proves the UI and the logic, not the SQL.**
- **SQL** ran on a throwaway local Postgres (PGlite/WASM, in a temp directory). Both paths were checked: a fresh `schema.sql`, and `main`'s schema with existing rows followed by the patch applied twice. `verify-rls.sql` and the new `verify-compete-upgrades.sql` both ran, and a JS-vs-SQL parity check covered 300 random quotes. Harness: `supabase/local-test/`.
- **Real Supabase** (PostgREST, Realtime, Storage, the actual patch on the actual DB) is not exercised anywhere. Those steps are listed under BLOCKED-BY-PATCH below.

---

## Gate 0: baseline on `main` (before any change)

| Check | Result |
|---|---|
| Unit tests | **104/104 pass** (4 files) |
| Build | green |
| Quote flow on the current UI, 390px + desktop (create, 3 items incl. 12.5 m², totals, send, customer view, viewed, accept, dashboard, convert, PDF figures) | **13/13 steps PASS at both sizes** (a copy of `main` with only the test backend swapped in) |

Baseline green, so the work proceeded.

## What changed (files)

**Logic (pure, tested)**
- `src/lib/quoteMath.js` (new): tiers, optional add-on toggling and totals, deposit split, expiry in the business time zone, the acceptance snapshot, the status timeline, follow-up eligibility.
- `src/lib/quotePayload.js` (new): form to row, validation, add/remove tiers. It only sends the new columns when they're used.
- `src/lib/demoData.js` (new): seed and exact removal.
- `src/lib/libraryForm.js`, `src/lib/brand.js` (new).
- `lineItems.js`: optional flag, detail line, validation, stepper, library insert. `money.js`: `percentOfCents`. `shareLinks.js`: follow-up builder.
- `publicQuote.js`: `acceptPublicQuoteV2` with a single-option fallback.
- `publicClient.js` (new): the customer page's small fetch-based RPC client. `publicPrefetch.js` (new). `quotesApi.js` (new). `pdfExport.js`: rewritten layout and content.

**UI**
- `tailwind.config.js` and `index.css`: the console's tokens, copied exactly.
- `components/ui/*` (new): line icon set, iOS sheet with drag-down, toast, form fields, stepper, switch, segmented control, brand mark/monogram, skeleton.
- `AppShell.jsx` (new): dark glass sidebar with an aura pill and live badge; bottom tab bar on phones.
- `StatusBadge.jsx`, `EmptyState.jsx`, `Timeline.jsx`, `LineItemEditor.jsx`, `LineItemRow.jsx`, `PhotoUpload.jsx`, `ShareButtons.jsx`, `ConfirmSheet.jsx`, `LibraryPicker.jsx`, `LibraryEntrySheet.jsx`, `NoAccess.jsx`.
- Pages: `Builder.jsx`, `Dashboard.jsx` and `PublicQuote.jsx` rewritten. `Login.jsx` restyled. New: `QuoteDetail.jsx`, `Library.jsx`, `Settings.jsx`.
- `App.jsx` and `OwnerApp.jsx` (route split). `state/QuotesStore.jsx` (one live list: realtime plus the existing 20s poll). Hooks: `useCountUp`, `useLocalDraft`, `useDemoData`.
- `main.jsx`, `index.html`, `vite.config.js`: brand variables, title from config, Supabase preconnect, early quote fetch.

**Config**
- `companyConfig.js`: new fields `timeZone`, `quoteValidityDays`, `depositDefault`, `paymentInstructions`, `quoteTerms`, `showPoweredBy`. The placeholder values are clearly fake.
- `configs/demo-config-2.js` (new): a second invented business for Gate 3.

**Database (files only)**
- `supabase/patches/2026-11-05-compete-upgrades.sql` (new), folded into `supabase/schema.sql`.
- `supabase/verify-compete-upgrades.sql` (new).
- `verify-rls.sql`: grant whitelist updated for `accept_public_quote_v2`.

**Addenda**
- `netlify/functions/health.mjs`, `src/lib/health.js`, `src/lib/healthClient.js`, `src/hooks/useHealth.js`: health endpoint and the status line in `AppShell.jsx`.
- `src/lib/payment.js`, `src/components/PaymentBlock.jsx`: the payment block, used in `PublicQuote.jsx`, `QuoteDetail.jsx` and `pdfExport.js`.
- `src/lib/suggestions.js`: Quick add and as-you-type matches in `Builder.jsx` and `LineItemEditor.jsx`.
- `netlify.toml`: the `/api/health` redirect. `companyConfig.js`: `paymentLink`. Tests in `src/lib/addendum.test.js`.

**Tooling and docs**
- `src/dev/mockBackend.js`: local test backend, dev-only.
- `supabase/local-test/`: SQL harness. `tools/gates/`: the Gate 2–5 scripts.
- `SETUP.md`: new config fields and patch order. `.gitignore`: `review-pack/` and `supabase/.temp/`.
- No dependency was added to `package.json`. The test tooling (playwright-core, PGlite, Lighthouse) was used from outside the repo.

## Gate 1: unit and regression

**213/213 pass** across 10 files, up from 104. All 104 original tests still pass unchanged.

New tests cover:
- Tier totals, including blank tier names, the 3-tier cap and the cheapest-option "from" price.
- Optional-item toggle maths: live totals and stale or required ids being ignored.
- Deposit split: percent with decimals and decimal commas, half-up rounding, fixed amount capped at the total, deposit + balance always equal to the total.
- Expiry: inclusive valid-until in the Johannesburg calendar (UTC midnight edge), only open statuses expire, display status.
- Demo seeding: covers every status, every row marked, `owner_id` never set by the client.
- Demo removal: always filtered by `is_demo` and `owner_id`, never unfiltered.
- Acceptance snapshot, typed-name validation, timeline states.
- Builder payload: new columns omitted on an unpatched DB, inline error copy, tier add/remove.
- Addenda: health check (probe, booleans only, the Netlify handler end to end), payment block (https-only link, wording per stage), suggestions (ranking, determinism, filtering, one-tap fill, the pass-2 stub).
- PDF content: tiers, add-ons, deposit, signature, payment instructions, no placeholder number.
- The v2 accept call and its fallback, the fetch RPC client, the early-fetch handoff, brand contrast, library entries.

Separately on PGlite (SQL, not counted above):
- `verify-rls.sql`: 27/27 PASS after the patch.
- `verify-compete-upgrades.sql`: 24/24 PASS, on both a fresh schema and main plus the patch applied twice.
- Backward compatibility: 3/3. A pre-patch link returns every original column unchanged, an accepted legacy link still resolves, and the old `accept_public_quote(token)` still accepts.
- Parity: 300/300 random quotes give the same total, deposit, balance, items and tier name in JS and in SQL.

## Gate 2: end-to-end flows (390px phone and 1280px desktop, test data only)

The brief's quote flow plus every new feature and the addenda: 55 steps, **PASS at both sizes**.

| Step | 390px | Desktop |
|---|---|---|
| A0 Wrong password shows an inline plain-language error | PASS | PASS |
| A1 Dashboard empty state (designed, with Load demo data) | PASS | PASS |
| A2 Saving an empty quote shows errors under the fields, no top banner | PASS | PASS |
| A3 Stepper 19 + 1 = 20 | PASS | PASS |
| A3 Line totals: 12.5 m² × R85 = R 1 062,50; 20 × R75 = R 1 500,00; 2 × R1 250,50 = R 2 501,00 | PASS | PASS |
| A3 Sticky bar total R 5 063,50 | PASS | PASS |
| A3 Default 50% deposit shown as split (R 2 531,75 / R 2 531,75) | PASS | PASS |
| A4 Saved as draft | PASS | PASS |
| A5 Local autosave: reload restores an unsaved edit; Discard reverts it | PASS | PASS |
| A6 WhatsApp share prefill is the v1 text (name, business, link) | PASS | PASS |
| A6 Email share is a mailto with subject | PASS | PASS |
| A6 Copy link sets status to sent and stamps `sent_at` | PASS | PASS |
| A7 Customer page shows total, deposit and balance | PASS | PASS |
| A7 First open marks the quote viewed, once | PASS | PASS |
| A8 Accept sheet requires name and consent, with inline errors | PASS | PASS |
| A8 Acceptance stores the typed name, consent, snapshot and total | PASS | PASS |
| A8 No JS errors on the customer page | PASS | PASS |
| A9 Dashboard shows accepted, the badge and the hero amount | PASS | PASS |
| A10 Detail shows the typed name, timestamp and timeline (done, done, done, current) | PASS | PASS |
| A11 Convert to invoice via a sheet, not `confirm()` | PASS | PASS |
| A12 **PDF figures match the quote exactly** (all three lines, total, deposit, signature, payment) | PASS | PASS |
| B1 Demo data: every status present on the dashboard | PASS | PASS |
| B2 WhatsApp follow-up has the quote number, "from" total and public link | PASS | PASS |
| B2 Expired quote: timeline ends in Expired, no follow-up offered | PASS | PASS |
| B3 Picking a tier updates the live total (Better R 6 700,00) | PASS | PASS |
| B3 The chosen tier is stored and the invoiced amount equals the tier total | PASS | PASS |
| B4 Toggling add-ons recalculates live (2 150 → 3 050 → 4 250 → 3 050) | PASS | PASS |
| B4 Acceptance freezes the selection | PASS | PASS |
| B5 Deposit quote shows due now vs balance | PASS | PASS |
| B6 Expired quote shows the designed state with no Accept button | PASS | PASS |
| B7 Library: inline validation, create, edit, delete via a sheet | PASS | PASS |
| B8 One-tap insert from the library; save a builder line to the library | PASS | PASS |
| B8 Tiered builder: the "From" total; saved with 2 tiers | PASS | PASS |
| D1 Health status line in the shell (the base config's placeholder WhatsApp number is flagged); shows "Database not reachable" when the probe fails | PASS | PASS |
| D2 Payment block on the open quote page, the invoice view and the owner's invoice detail; no Pay online button when `paymentLink` is empty | PASS | PASS |
| D3 Quick add ranks most-used first; one tap fills the empty row with the library rate | PASS | PASS |
| D3 As-you-type match fills mode, rate and detail in one tap; added items drop out of Quick add | PASS | PASS |
| B9 **Dashboard updates live, without a reload, when the customer accepts** | PASS | PASS |
| B10 Remove demo data deletes exactly the seeded rows; another owner's demo row and the real rows are kept | PASS | PASS |
| C1 Slow load (>2s): skeleton, then a calm "still loading" line | PASS | PASS |
| C2 Failed load: plain message, retry, and real contact details only (no fake number) | PASS | PASS |
| C3 Offline: designed offline state | PASS | PASS |
| No horizontal scroll on any captured screen; no JS errors; no request left localhost | PASS | PASS |

**The new frontend on the database as it is today (pre-patch)**: 9 steps, **PASS at both sizes**.
- With deposit or valid-until defaults on, saving shows a clear "needs the November database update" message and keeps the work.
- With them off, a plain quote saves, sends and is accepted. Acceptance falls back to the existing `accept_public_quote`, so the typed name is not stored until the patch is applied.
- The legacy timeline shows "Time not recorded" for sent quotes. Convert and PDF work.
- The library shows a designed "almost ready" state. Demo data refuses cleanly, with no partial seed.

### BLOCKED-BY-PATCH: steps that need the patch on a real database (not run)

*Update 8 Nov: the patch is on dropstack-dev and the build is live. Steps 1–3 were done by Ziggy/Tom on Nov 6; 15–16 were covered read-only above. The rest still need a test login and test data on live.*

Run these after the patch is applied (Gate 6), with test data only:

1. Paste `supabase/patches/2026-11-05-compete-upgrades.sql` into the SQL editor. It should commit without error.
2. Run `supabase/verify-rls.sql`: every row PASS (27).
3. Run `supabase/verify-compete-upgrades.sql`: every row PASS (24).
4. Open an existing live quote link created before the patch. It renders unchanged, and the old deployed app still accepts it.
5. With the new build pointed at that DB: create a quote with options, an add-on and a deposit, then save. Check in Table Editor that `tiers`, `deposit_*` and `valid_until` are stored.
6. Send it, and check `sent_at` is stamped.
7. Open the link in a private window (anon): it shows viewed, and acceptance needs the typed name and consent tick. Accept Better with the add-on.
8. Check that `accepted_name`, `accepted_tier_id`, `accepted_selection` and `total` were stored, and that the totals were recomputed by the server.
9. The dashboard flips to Accepted via **Supabase Realtime**. The test backend only stood in for it; the realtime code path itself is unchanged from v1.
10. Convert to invoice. The PDF matches.
11. Set `valid_until` to yesterday in Table Editor. The link shows Expired, and calling `accept_public_quote_v2` returns `expired`.
12. Item library CRUD.
13. Load demo data, then Remove demo data. Only this login's `is_demo` rows go.
14. Photo upload on a line item (Storage). The code is unchanged, but it hasn't been exercised this pass.
15. Gate 5 on the deployed URL: the real Supabase round trip replaces my emulation.
16. `GET /api/health` on the deploy (Netlify Function, never run here). Expect `ok: true`, `database: true`, and booleans only, with no key, URL, number or address. Check that the dashboard status line agrees.

## Gate 3: config swap (second demo config)

`configs/demo-config-2.js` ("Example Coastal Landscapes": no logo, brand #1F4E79, number 27000000099, fixed R 2 000 deposit, 14-day validity, Powered-by line off) was copied over `companyConfig.js` in a scratch copy and built. Result: **10/10 PASS at both sizes.** The second config also sets `paymentLink`.

- Tab title, the monogram "EC" and the brand colour on the primary button all switch.
- The builder defaults switch, and the WhatsApp prefill uses the new name.
- The customer page shows the new name, the R 2 000,00 deposit, the new terms and email, and no Powered-by line.
- The consent wording names the new business. Payment instructions come from the new config, and the Pay online button links to its `paymentLink`. The PDF prints the link.
- The health line reads "All systems normal" (this config's number and payment details are set).
- The PDF has the new name, "WhatsApp +27000000099" and the monogram.
- The failure fallback links to wa.me/27000000099.
- A leftover scan (page text, prefills, PDF) found **zero** traces of the base config ("Placeholder", its email, the `27XXXXXXXXX` number).

## Gate 4: visual review pack

**https://claude.ai/artifact/KW3Xr6z5nhj9BEzfAR1SXN** (private to Tom's account; share it from the page's Share menu for Ziggy). Local copy: `review-pack/index.html` (gitignored, 15 MB).

It has 47 screens at 390px and desktop, with before and after wherever a before exists:
- **Builder**: empty, filled, error, tiers.
- **Dashboard**: empty, populated, demo.
- **Customer page**: single option, tiered, optional add-ons, deposit, expired, accepted (success), accept sheet with errors, slow, failed, offline, bad link, invoice.
- **Quote detail**: with timeline; accepted, expired, convert sheet.
- **Library, settings and login.**
- **Addenda**: health line, Quick add, as-you-type match, payment block.
- **Pre-patch states.**
- **The second config.**
- **PDF page 1**: before and after, plus the second config.

## Gate 5: performance and basics

Local production build, served gzipped like a CDN, with the cache cleared before every run and all non-localhost hosts unresolvable. Mobile Lighthouse 12.8, lowest of 3 runs:

| Screen | Performance (3 runs) | LCP (simulated slow 4G) | Accessibility | Best practices | Weight | LCP element |
|---|---|---|---|---|---|---|
| Customer quote page | **99** / 100 / 100 | 1.54–1.70 s | 100 | 100 | 87 KB | content text (the payment details line) |
| Customer page, tiered | **99** / 99 / 99 | 1.54–1.70 s | 100 | 100 | 87 KB | content |
| Dashboard | **99** / 99 / 99 | 1.87 s | 100 | 100 | 102 KB | the hero stat figure |

**Fast-3G LCP check** (§2A): DevTools throttling at 1.6 Mbps down, 750 Kbps up, 562.5 ms RTT, 4x CPU, on the customer page.
- The test backend's data call isn't network traffic, so I emulated the Supabase round trip with a fixed delay:
  - Pessimistic, cold DNS+TLS+request (1700 ms): LCP 2.43 / 2.47 / **2.49 s**.
  - Connection already warmed by the preconnect (700 ms): **1.85–1.86 s**.
- Both are under 2.5 s, the pessimistic one only just. **Re-measure on the live URL in Gate 6.**

Getting there took three changes, all real code:
1. The customer page no longer loads supabase-js. It uses a small fetch RPC client, and supabase-js plus all owner screens moved into a lazy chunk. The customer's entry bundle is 69.5 KB gzipped; the v1 main bundle was 125 KB.
2. A Supabase preconnect in `index.html`.
3. A small inline script in `index.html` starts the quote request while the HTML is still parsing, and the page picks it up. Before these changes, throttled LCP was 3.4 s.

These numbers were re-measured after the addenda.

Accessibility spot checks on dashboard, builder, detail, library, settings and the customer page, at both sizes (also re-run after the addenda):
- Every input has a label.
- Every tap target is at least 44px. Segmented controls, filter chips and the share link were raised from 40px to fix this.
- The focus ring is visible on every tabbed element.
- Status-pill contrast: draft 8.16, sent/viewed 5.09, accepted/paid 4.83, invoiced 5.12, expired 5.29, demo 5.07 (all at least 4.5:1).
- No emojis anywhere in UI, copy or toasts (swept); no Netlify badge; no exclamation marks in toasts.

## Addenda (folded in mid-build, scope kept to exactly these)

**1. Health endpoint and status line**
- `GET /api/health` is a Netlify Function (`netlify/functions/health.mjs`). The redirect is in `netlify.toml`, ahead of the SPA fallback.
- It returns `ok`, `healthy`, `database` (boolean), `databaseLatencyMs`, `configComplete` and `config.*`, all booleans: business name, logo, a valid WhatsApp number, a real contact email, payment instructions, a payment link, Supabase URL and anon key. It never returns a value. A test asserts that no key, URL, number, email or name appears in the response.
- The database probe is the public read function `get_public_quote` called with an all-zero token: a SELECT that matches nothing and writes nothing.
- It reads `SUPABASE_URL`/`SUPABASE_ANON_KEY`, falling back to the existing `VITE_` variables. No new secrets.
- Logic lives in `src/lib/health.js`, shared with the client. The shell shows a status line ("All systems normal" / "Connected · add WhatsApp number" / "Database not reachable" / "Setup incomplete"). It sits at the bottom of the sidebar on desktop and under the content on phones, checking at start and every 60 s while visible.
- Plain `vite dev` has no functions, so the line reads "Status check unavailable" there. `netlify dev` serves it.

**2. Payment link**
- New `companyConfig.paymentLink` (https only; `""` hides it; empty in the base config so no fake link ships).
- One payment block (`src/lib/payment.js`, `PaymentBlock.jsx`) holds the bank details, the reference, and a Pay online button when the link is set.
- It appears on the customer quote page at every stage except paid and expired. On an open quote it reads "Payment details" with "Pay once you've accepted this quote", and "How to pay" once accepted or invoiced.
- It also appears on the invoice view, the owner's invoice detail, and the PDF, where the link is clickable. No payment processing or status sync.

**3. Smart line-item suggestions** (`src/lib/suggestions.js`)
- Sources: the item library and the line items of past quotes the user can see, including every tier and frozen acceptance.
- Ranking:
  - Score is the number of quotes an item appears in, counted once per quote, plus 0.5 if it's in the library.
  - Ties break on most recent use, then name.
  - Price, mode and detail come from the library entry when one exists, otherwise the most recent use.
- Items already on the quote are left out, and so is the quote being edited.
- The builder shows a **Quick add** chip row (top 8, one tap; it fills the empty starter row instead of adding a second card) and **as-you-type matches** under each description (top 3 once 2+ characters are typed; one tap fills mode, rate and detail and keeps the quantity).
- **Deterministic only: no network calls, no AI.**
- **Pass-2 stub point:** `buildSuggestions({ ..., extra })` already accepts and ranks extra candidates (`{ name, detail, mode, rate, source: "draft" }`). Generative drafting from voice notes or photos would be a separate module feeding `extra`; real library and history data always win on a name clash. Nothing produces `extra` in this pass, pending Tom's decision. This is documented at the top of `suggestions.js`.

## Schema patch summary (for Ziggy)

Everything is additive and runs in one transaction.

**Data**
- New columns on `quotes`: `tiers`, `deposit_type`, `deposit_value`, `valid_until`, `sent_at`, `accepted_name`, `accepted_consent`, `accepted_tier_id`, `accepted_selection`, and `is_demo` (default false). They have named check constraints and a partial index on demo rows.
- New table `quote_library_items` with the same owner-or-allowlist RLS as `quotes`. anon has no grants on it.

**Triggers**
- The stamp trigger now also sets `sent_at`.
- The anon guard covers the new columns. The acceptance columns can only change inside `accept_quote_as_customer()`, which sets a transaction-local flag around its single UPDATE.

**Public functions**
- `get_public_quote(text)` keeps its name and argument and returns a superset of columns, including a server-side `is_expired`. It is dropped and recreated inside the same transaction because Postgres can't add output columns in place.
- `accept_public_quote(text)` keeps its signature. It still works for single-option quotes, and now refuses tiered and expired quotes.
- New `accept_public_quote_v2(token, full_name, consent, tier_id, optional_ids)` returns a reason code. It recomputes every total and the deposit from the stored items, so the client only chooses a tier and which add-ons to include. It is a separate name rather than an overload, so PostgREST can't resolve it ambiguously.
- `quote_business_today()` is the single place the time zone (Africa/Johannesburg) lives.

**Grants and order**
- New functions follow the existing revoke-all-then-grant pattern.
- **Apply the patch before deploying the new frontend** (now noted in SETUP.md). If the frontend ships first it degrades gracefully, as the pre-patch run above shows.

## Behaviour changes (every one)

1. **Acceptance needs a typed full name and a consent tick.** v1 was one tap. If the patch isn't applied, a single-option quote falls back to the old accept, and the name isn't stored.
2. **Tiered quotes**: the customer picks an option. After acceptance the row's `total` and `subtotal` become the accepted amount, recomputed by the server, so they include ticked add-ons. `line_items` and `tiers` keep the original offer.
3. **Accepted quotes with a frozen snapshot can't be edited** in the builder, so the invoice always matches what the customer agreed. Quotes accepted before the patch stay editable with the old warning.
4. **New quotes default to a 50% deposit and a valid-until 30 days out**, both from config and both editable or clearable per quote. **Tom's call**: these are on in the base config; set `depositDefault: null` and `quoteValidityDays: 0` to keep v1's behaviour.
5. **Dashboard rows open a new quote detail screen** at `/quotes/:id`; v1 opened `/builder/:id`. Editing is one tap from there. New routes: `/quotes/:id`, `/library`, `/settings`. All v1 routes still work.
6. **Expired** is a derived display status, not a new database status, so the status enum is unchanged. It gets its own pill and filter, and "Out with customers" excludes expired quotes.
7. **Convert to invoice confirms through a sheet** instead of `window.confirm()`.
8. **Builder drafts autosave to the device** about 400 ms after each change. Reopening offers "Restored your unsaved changes" with Discard. The draft is cleared on save.
9. **Error copy is rewritten** to plain-language fixes (e.g. "Customer name is required." became "Enter the customer's name"). Errors sit under the field instead of at the bottom of the form.
10. **Status pills are sentence case** ("Accepted"); v1 was uppercase.
11. **The PDF layout is refreshed**:
    - The brand-filled table header became a hairline header.
    - It adds the monogram fallback, options, add-ons, deposit split, valid-until, the acceptance signature, payment instructions, terms and a demo note.
    - It **no longer prints the WhatsApp line when the number is invalid**; v1 printed "WhatsApp +27XXXXXXXXX" with the placeholder config.
    - PDF figures are unchanged.
12. **Customer page states are designed**:
    - Slow, failed and offline states now exist. v1 showed "not available" for network errors too.
    - The failure and expired states offer WhatsApp/Call/Email using the config's real details. These are hidden when the number is the placeholder.
    - A small "Powered by DropStack" line appears (config `showPoweredBy`, default on; **Tom's call** per client).
13. **The customer page no longer loads supabase-js**:
    - It calls the same three RPCs, as anon, through `fetch`.
    - `index.html` now preconnects to the Supabase host and contains a tiny inline script that starts `get_public_quote` early. That script **embeds the anon key**, which was already public in the JS bundle and only grants what RLS and the granted RPCs allow.
    - Landscaper previews still don't count as a view: the page checks for the stored session key.
14. **The browser tab title** is now "<businessName> quotes"; v1 was a fixed "Quotes".
15. **New WhatsApp follow-up template** (manual tap only), on dashboard rows and the detail screen for sent or viewed quotes that aren't expired. **The v1 send prefill is unchanged.**
16. **New (addenda):** the shell's health status line; the payment block (bank details and link) now shows on the open quote too, not only after acceptance; a Quick add row plus as-you-type matches in the builder; adding from the library or Quick add fills the empty starter row instead of appending.
17. **Demo data** is marked by `is_demo`, a Demo pill, a "demo quote" note on the customer page and the PDF, and test contact details (+2700000000x, @example.com). Customer names are plain invented first names with an initial.

## Flagged / not done / for Tom or Ziggy

- **Deployed on Tom's approval** via PR #1 (see the Deployment section). This REPORT update itself is on the branch with PR #2 open and unmerged, since merging it triggers another production build (Netlify credits).
- **Real Supabase isn't exercised.** PostgREST resolving the new function, Realtime and Storage are all in the BLOCKED-BY-PATCH list, as is `/api/health` on Netlify.
- **Suggestions read every quote the login can see.** On the shared DB a staff login would get suggestions from other owners' quotes, which is the same allowlist caveat as below.
- **The Fast-3G pass is emulated and marginal** (2.49 s worst case). Measure on the live URL.
- **Staff logins see every owner's quotes on the shared `dropstack-dev` DB.** That is the pre-existing allowlist model: `is_business_user()` is table-wide. Demo removal is scoped by owner for that reason. It's worth a look before more businesses share that DB.
- **The expiry time zone is fixed** to Africa/Johannesburg in SQL and in config. Change both together for a client elsewhere.
- **Drag-down-to-dismiss on sheets is built** (pointer events with a spring settle) but wasn't driven by the scripts. Backdrop tap, the close button and Escape are covered. Check it with a thumb on a real phone.
- **Nothing was run on a physical phone.** Everything is Chromium phone emulation.
- **`src/dev/mockBackend.js` lives in the repo.** It is dev-only and compiled out unless `VITE_MOCK_BACKEND=1` is set. It's also handy for sales demos on a laptop. Delete it if you'd rather not carry it.
- **Gate 4's "before" shots** come from `main`'s code running on the same test backend, so they show the v1 UI exactly.
- **Bugs found and fixed during the gates**:
  - A `<fieldset>` made the builder 494px wide on a 390px phone, and the phone zoomed out.
  - Editing a library item quickly could save it as a new item.
  - Settings counted other owners' demo rows.
  - The attribution line failed contrast.
  - Five control types were under 44px.
- **A repo hygiene slip, fixed**: an early commit swept in the untracked `supabase/.temp/` (Supabase CLI state). I rewrote only this unpushed branch to drop it, restored the files byte-for-byte as untracked, and gitignored the folder. `main` was never touched.
- **Not built, per the audit's NOT-building list**: card payments, Xero/QuickBooks sync, scheduling/dispatch, recurring invoices. The deposit is payment *instructions* only.

## Where this tool still loses to Jobber, in my judgement

On the quote-to-accept moment, this now holds its own. A landscaper can build Good/Better/Best from the library on a phone, send it on WhatsApp, and the customer can pick, add an upsell and sign with their name, while the owner watches it land live. That is the slice Jobber charges Grow-tier money for, delivered in the channel Jobber doesn't have.

Beyond that moment it still loses, and mostly not on polish:

- **Money.** There is no integrated online payment: the deposit is bank details plus, at best, a link out to the client's own payment page, and nothing marks the quote paid when the money lands. Jobber's deposit is a card button that gets paid, and reconciled, while the customer is still excited.
- **VAT.** There is no VAT or tax handling at all, which matters for any VAT-registered South African client.
- **Accounting and job costing.** No Xero/QuickBooks sync, and no costs or margins on line items, so the owner can't see whether a tier is profitable.
- **Signature evidence.** A typed name with a timestamp is weaker than Jobber's signature capture and audit trail if a customer later disputes the work.
- **What happens after "yes".** No scheduling, no visit history, no client hub where the customer can see every quote and invoice they've had, and no automated reminders, which is permanent doctrine here.
- **Team and devices.** No per-user roles; the allowlist gives every staff login all quotes. No native app; drafts autosave, but nothing sends offline.
- **Photos and reporting.** One photo per line, and reporting that stops at the hero strip.

None of these are things a prospect sees in a two-minute demo. They are what an established business notices in its second month. The first two, payments and VAT, are where I'd spend the next pass.
