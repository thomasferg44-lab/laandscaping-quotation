# New client setup

This checklist turns this repo into one client's quote tool. Each client gets
their own copy of the repo, their own Supabase project and their own Netlify
site. Nothing is shared between clients.

Expect about **5 minutes of hands-on work**. Creating the Supabase project and
the first Netlify build each add a couple of minutes of waiting on top.

Collect from the client first:

- [ ] Business name, as it should appear on quotes
- [ ] Logo file (PNG or SVG, wide or square, transparent background is fine)
- [ ] Brand colours: one main colour and one accent, as 6-digit hex codes like `#2F5233`
- [ ] Their WhatsApp number (it's printed on the PDF)
- [ ] The email address customers should reply to
- [ ] The email address they will log in with
- [ ] The web address they want (e.g. `quotes.theirdomain.co.za`, or `<client>.dropstack.co`)

---

## 1. Make the client's copy (1 min)

- [ ] On GitHub, create a new **private** repo named `quotes-<client>` and push
      this repo's `main` into it:
      ```sh
      git clone https://github.com/thomasferg44-lab/laandscaping-quotation.git quotes-<client>
      cd quotes-<client>
      git remote set-url origin https://github.com/<you>/quotes-<client>.git
      git push -u origin main
      ```
- [ ] `git checkout -b client-config` (all edits below go on this branch → PR → merge)
- [ ] `npm install`

## 2. Edit `companyConfig.js` (2 min)

This is the **only** file with client details. Change every value:

| Field | What to put | Where it shows |
|---|---|---|
| `businessName` | `"Client Garden Co"` | Every page header, the PDF, the WhatsApp/email message |
| `logoUrl` | `"/client-logo.svg"` (see below) | Page headers, PDF |
| `primaryColor` | `"#RRGGBB"` | Primary buttons, quote page accents, the monogram, PDF title. Text on it switches to dark automatically if white would be unreadable |
| `accentColor` | `"#RRGGBB"` | PDF divider line |
| `currency` | `"ZAR"` | All amounts. Leave as ZAR for SA clients |
| `whatsappNumber` | Digits only, `27` instead of the leading `0`, no `+`. `082 123 4567` → `"27821234567"`. Use `""` to leave it off | PDF, and the "WhatsApp us / Call" fallback on the quote page when it can't load or has expired. The placeholder value shows nothing |
| `contactEmail` | `"quotes@theirdomain.co.za"`. Use `""` to leave it off | Quote page footer, PDF |
| `paymentMethods` | Leave as `[]` | Not used yet |
| `timeZone` | `"Africa/Johannesburg"` | Which calendar day a quote expires on. The database uses the same zone in `public.quote_business_today()` (schema.sql): change both together |
| `quoteValidityDays` | e.g. `30`, or `0` for no default expiry | Default "Valid until" on new quotes (editable per quote) |
| `depositDefault` | `{ type: "percent", value: 50 }`, `{ type: "fixed", value: 1500 }` or `null` | Default deposit on new quotes (editable per quote) |
| `paymentInstructions` | The client's real bank/EFT details as one sentence | Accepted quote, invoice and PDF ("How to pay"). Plain text, no payment processing |
| `paymentLink` | `"https://…"` (the client's own PayFast/Yoco/SnapScan page), or `""` | A Pay online button next to the bank details on the quote page and invoice, printed on the PDF. https only. No payment sync |
| `quoteTerms` | One short sentence, or `""` | Quiet line under the totals on the quote page and PDF |
| `showPoweredBy` | `true` / `false` | The small "Powered by DropStack" line on the customer's page |

- [ ] No logo? Set `logoUrl` to `""`: the app and PDF use an initials monogram in the brand colour.
- [ ] Colours are exactly 6 hex digits with `#`. A 3-digit code like `#2F5`
      makes the PDF fall back to the default green.

Logo:

- [ ] Copy the client's logo into `public/`, e.g. `public/client-logo.svg`
- [ ] Delete the old logo from `public/` (`git rm public/placeholder-logo.svg`)
- [ ] Set `logoUrl` to `"/client-logo.svg"`, with the leading slash and no `public/`

Optional:

- The browser tab title now comes from `businessName` automatically.

## 3. Supabase project (1 min hands-on)

- [ ] [supabase.com](https://supabase.com) → New project, named `quotes-<client>`,
      region **South Africa (Cape Town)** if offered, otherwise the closest one
- [ ] SQL editor → paste all of `supabase/schema.sql` → Run.
      This creates the table, security rules, triggers, live updates and the photo bucket.
      Skip `supabase/patches/`: those files are only for older projects.
- [ ] Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
      **Don't skip this.** Supabase leaves sign-ups on by default, so anyone
      with the site's public key could otherwise create a login. They still
      couldn't see the client's quotes (only allowlisted logins can), but
      there's no reason to let them in at all.
- [ ] Authentication → Users → **Add user → Create new user**: the client's
      email, a strong temporary password, "Auto confirm user" **on**
- [ ] Give that login access: open `supabase/add-business-user.sql`, put the
      client's email on the marked line, paste it into the SQL editor → Run.
      The result should list their email. **Skip this and the client sees
      "No access yet" after logging in.**
- [ ] Paste all of `supabase/verify-rls.sql` into the SQL editor → Run.
      Every row must say **PASS**. It changes nothing and works on an empty project.
- [ ] Same for `supabase/verify-compete-upgrades.sql` (options, typed-name
      acceptance, deposit, expiry, item library, demo data). Every row **PASS**.
- [ ] Project Settings → API: keep this tab open for the next step
      (Project URL and the `anon` `public` key)

### Existing projects (already live before November 2026)

Apply `supabase/patches/2026-11-05-compete-upgrades.sql` in the SQL editor
**before** deploying this version of the app, then run both verify scripts.
The patch is additive and keeps old quote links and the old app working.
If the app ships first: plain quotes still work, but options, deposits,
valid-until dates, the item library and demo data say they need the update.

## 4. Local check (1 min)

- [ ] Create `.env` from the template and fill it in. It's gitignored, so never commit it:
      ```sh
      cp .env.example .env
      # VITE_SUPABASE_URL=<Project URL>
      # VITE_SUPABASE_ANON_KEY=<anon public key>
      ```
- [ ] `npm test`: all tests pass
- [ ] `npm run build`: ends with `✓ built`
- [ ] `npm run dev`, log in with the client's email, and check that the name,
      logo and colours are right
- [ ] Build one test quote and download its PDF. Logo, name, colours, email and
      number should all be the client's. Use `Test Customer` / `+27000000000`.
      For a full run-through, follow `docs/manual-test-whatsapp.md`.
- [ ] Delete the test quote
- [ ] Commit, open a PR for `client-config`, and merge it

## 5. Deploy on Netlify (1 min hands-on)

- [ ] Netlify → Add new site → Import from Git → pick `quotes-<client>`.
      The build settings come from `netlify.toml` (`npm run build`, publish `dist`),
      so leave them as they are.
- [ ] Site configuration → Environment variables → add both, with the same values as `.env`:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- [ ] Deploys → Trigger deploy. Wait for **Published**.
- [ ] Domain management → add the client's domain, then set DNS at Namecheap
      (CNAME to the Netlify site). Netlify adds HTTPS automatically.
- [ ] Supabase → Authentication → URL Configuration → set **Site URL** to the
      live address
- [ ] On your phone, open `https://<live address>/login`, log in, and check
      the logo and name. Open one quote link from WhatsApp and check it
      shows without a login.

Health check (after deploy):

- [ ] Open `https://<site>/api/health`. It should show `"ok": true`, `"database": true` and `"configComplete": true`. It only ever shows true/false, never keys or contact details.
- [ ] The dashboard's status line (bottom of the sidebar, or under the content on a phone) agrees.

## 6. Send the client

Send the login details in two separate messages:

**Message 1 (WhatsApp or email):**

> Hi <name>, your quote tool is ready: https://<live address>
>
> Log in with <client email>. I'll send your password separately.
>
> How it works:
> 1. Tap **+ New quote**, add the customer and the line items (use Area for
>    m² jobs, Per unit for plants and pavers, Per load for soil and rubble,
>    Day rate for labour). You can add a photo to any line.
> 2. Tap **Save**, then **WhatsApp**, **Email** or **Copy link** to send it.
> 3. Your customer opens the link on their phone and taps **Accept**.
>    Your dashboard updates by itself.
> 4. When the job is done, open the quote and tap **Convert to Invoice**.
> 5. **Download PDF** works at every step.
>
> Add the link to your home screen so it's one tap away.

**Message 2 (a different channel, e.g. SMS if message 1 was WhatsApp):**

> Your password: <temporary password>

There's no change-password screen yet. If they want a new password, set it
for them in Supabase → Authentication → Users.

## Adding the client's staff

Each staff member gets their own login. They all see and edit all of the
business's quotes.

- [ ] Supabase → Authentication → Users → **Add user → Create new user**:
      their email, a strong temporary password, "Auto confirm user" **on**
- [ ] Run `supabase/add-business-user.sql` with their email, and a note like
      `'staff: Sipho'` on the second marked line
- [ ] Send them the site link and password the same way as in step 6

To remove someone, delete their user under Authentication → Users. That ends
their login and their allowlist entry. To keep the login but block access,
use the `delete from public.business_users …` line at the bottom of
`add-business-user.sql`.

A login that exists but isn't allowlisted sees a "No access yet" screen.
At the database level it can only see quotes it created itself, and with
sign-ups off nobody can make one of those.

---

## Done when

- [ ] The live site shows the client's name, logo and colours
- [ ] A quote sent to a test phone opens without a login and its PDF matches
- [ ] Sign-ups are turned off in Supabase
- [ ] `verify-rls.sql` shows PASS on every row
- [ ] `.env` was never committed (`git log --all -- .env` prints nothing)
- [ ] The client has received both messages
