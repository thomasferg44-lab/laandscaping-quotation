// Per-client white-label config. This is the ONLY place client-specific,
// non-secret data lives. Swap this file per deploy (see SETUP.md). Secrets
// go in .env. The values below are deliberately fake placeholders.
export const companyConfig = {
  businessName: "Placeholder Garden Services",
  // Logo shown on the quote page, app and PDF. "" falls back to a clean
  // initials monogram in the brand colour.
  logoUrl: "/placeholder-logo.svg",
  primaryColor: "#2F5233",
  accentColor: "#8B6F47",
  currency: "ZAR",
  // Landscaper's own number: the quote page's "message us" fallback and the
  // PDF. Per client: digits only, no + (e.g. "27821234567"), or "" to leave
  // it off. The placeholder below is deliberately invalid, so no WhatsApp
  // button renders until a real number is set.
  whatsappNumber: "27XXXXXXXXX",
  contactEmail: "quotes@placeholder-garden.invalid", // .invalid never resolves
  paymentMethods: [], // e.g. ['payfast'] once wired — empty in v1

  // --- Compete pass (2026-11-05) -------------------------------------------
  // Business calendar for quote expiry. The database uses the same zone
  // (public.quote_business_today() in schema.sql): change both together.
  timeZone: "Africa/Johannesburg",
  // New quotes get a valid-until date this many days out (editable per
  // quote, clearable). 0 = no default expiry.
  quoteValidityDays: 30,
  // Default deposit for new quotes, editable per quote. null = no deposit.
  // { type: "percent", value: 50 } or { type: "fixed", value: 1500 }
  depositDefault: { type: "percent", value: 50 },
  // Shown on the accepted quote, the invoice and the PDF when a deposit or
  // balance is due. No payment processing: this is plain text. Placeholder
  // values below are deliberately fake.
  paymentInstructions:
    "EFT to Placeholder Garden Services, Example Bank, account 0000000000, branch 000000. Use your quote number as the reference.",
  // Optional online payment page (the client's own PayFast/Yoco/SnapScan
  // link or similar), shown as a "Pay online" button next to the bank
  // details and printed on the PDF. https only; "" hides it. No payment
  // processing or status sync in this tool.
  paymentLink: "",
  // Quiet terms line under the totals on the quote page and PDF. "" hides it.
  quoteTerms: "Prices include labour and materials listed. Work is scheduled once the quote is accepted.",
  // The only attribution allowed on customer pages (design spec §2A).
  showPoweredBy: true,
};
