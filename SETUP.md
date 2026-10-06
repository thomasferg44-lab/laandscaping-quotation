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
| `primaryColor` | `"#RRGGBB"` | Buttons, headings, PDF table header |
| `accentColor` | `"#RRGGBB"` | PDF divider line |
| `currency` | `"ZAR"` | All amounts. Leave as ZAR for SA clients |
| `whatsappNumber` | Digits only, `27` instead of the leading `0`, no `+`. `082 123 4567` → `"27821234567"`. Use `""` to leave it off | Printed on the PDF as "WhatsApp +27…" |
| `contactEmail` | `"quotes@theirdomain.co.za"`. Use `""` to leave it off | Quote page footer, PDF |
| `paymentMethods` | Leave as `[]` | Not used yet |

- [ ] Colours are exactly 6 hex digits with `#`. A 3-digit code like `#2F5`
      makes the PDF fall back to the default green.

Logo:

- [ ] Copy the client's logo into `public/`, e.g. `public/client-logo.svg`
- [ ] Delete the old logo from `public/` (`git rm public/green-roots-logo.svg`)
- [ ] Set `logoUrl` to `"/client-logo.svg"`, with the leading slash and no `public/`

Optional:

- [ ] Change the browser tab title in `index.html` (`<title>Quotes</title>`)

## 3. Supabase project (1 min hands-on)

- [ ] [supabase.com](https://supabase.com) → New project, named `quotes-<client>`,
      region **South Africa (Cape Town)** if offered, otherwise the closest one
- [ ] SQL editor → paste all of `supabase/schema.sql` → Run.
      This creates the table, security rules, triggers, live updates and the photo bucket.
      Skip `supabase/patches/`: those files are only for older projects.
- [ ] Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
      **Don't skip this.** Any logged-in user can see every quote, so nobody
      but the client may be able to create an account.
- [ ] Authentication → Users → **Add user → Create new user**: the client's
      email, a strong temporary password, "Auto confirm user" **on**
- [ ] Project Settings → API: keep this tab open for the next step
      (Project URL and the `anon` `public` key)

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
- [ ] Optional: send one quote, then paste `supabase/verify-rls.sql` into the
      SQL editor. Every row should say PASS.
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

---

## Done when

- [ ] The live site shows the client's name, logo and colours
- [ ] A quote sent to a test phone opens without a login and its PDF matches
- [ ] Sign-ups are turned off in Supabase
- [ ] `.env` was never committed (`git log --all -- .env` prints nothing)
- [ ] The client has received both messages
