# Manual test: quote → PDF → WhatsApp share

`npm test` already covers the quote maths, PDF contents and how the
`wa.me` link is built. This script covers what it can't: real Supabase,
a real browser, and what happens when the WhatsApp button is tapped.
It takes about 5 minutes. Run it before each client hand-over.

**Test data only.** Use `Test Customer`, `+27000000000` and
`test@example.com`. Only step 7 uses a real number, and that number must be
a phone you own.

## Setup

- [ ] `.env` points at the client's Supabase project (or a test project)
- [ ] `npm run dev`, then open the app on a phone or in a desktop browser's mobile view
- [ ] Log in as the landscaper

## Steps

1. **Create a quote.** Dashboard → New quote. Customer name `Test Customer`,
   phone `+27000000000`, email `test@example.com`.
   - [ ] Tapping into any field on an iPhone does **not** zoom the page
2. **Add line items.**
   - Area: `Instant lawn`, 40 m² × 85 → line shows **R 3 400,00**
   - Per unit: `Pavers`, 3 × 0.10 → line shows **R 0,30**
   - Per load: `Compost`, 2 × 1250,50 → line shows **R 2 501,00**
   - Plain: `Tree removal`, 1999.99 → line shows **R 1 999,99**
   - [ ] Footer total shows **R 7 901,29** (no `7 901,2900001` or similar)
   - [ ] Optional: attach a photo to one line; thumbnail appears
3. **Save draft.**
   - [ ] "Saved" time appears and URL changes to `/builder/<id>`
   - [ ] Reload the page: same lines, same total
4. **Generate the PDF.** Tap **Download Quote PDF**.
   - [ ] File is named `Quote-Test_Customer-XXXXXX.pdf`
   - [ ] Logo, business name and colours match `companyConfig.js`
   - [ ] Every line and the total match the screen exactly
5. **Check the WhatsApp link without sending.** Long-press (or right-click)
   the WhatsApp button → copy link. Paste it somewhere to read it.
   - [ ] It starts with `https://wa.me/27000000000?text=`
   - [ ] The decoded text says `Hi Test Customer,`, the business name, and
         `https://<your host>/quote/<id>`
6. **Check the status change.** Tap WhatsApp. On a desktop, WhatsApp
   Web will say the number isn't on WhatsApp. That is expected for the fake
   number, and nothing is sent.
   - [ ] Back in the builder, status is now **Sent**
   - [ ] Dashboard shows the quote as Sent without reloading
7. **Real send (only with a number you own).** Edit the phone to your own
   second phone, save, and tap WhatsApp on a phone.
   - [ ] WhatsApp opens a chat to that number with the message pre-filled
   - [ ] Send it. On the receiving phone, tap the link: the quote page opens
         with no login, and its total matches the PDF
   - [ ] Tap Download PDF on that page: same PDF as step 4
   - [ ] Landscaper dashboard shows **Viewed** without reloading
8. **Clean up.** Put the phone back to `+27000000000`, or delete the test quote.

## Notes

- WhatsApp sends the **link** to the hosted quote, not the PDF file. The
  customer downloads the PDF from that page. `wa.me` links can't attach
  files.
- If the WhatsApp button is greyed out, the phone number didn't parse.
  Accepted forms: `082 000 0000`, `+27 82 000 0000`, `0027820000000`.
