// Per-client white-label config. This is the ONLY place client-specific,
// non-secret data lives. Swap this file per deploy (see SETUP.md). Secrets
// go in .env. The values below are deliberately fake placeholders.
export const companyConfig = {
  businessName: "Placeholder Garden Services",
  logoUrl: "/placeholder-logo.svg",
  primaryColor: "#2F5233",
  accentColor: "#8B6F47",
  currency: "ZAR",
  // Landscaper's own number, printed on the PDF. Per client: digits only,
  // no + (e.g. "27821234567"), or "" to leave it off.
  whatsappNumber: "27XXXXXXXXX",
  contactEmail: "quotes@placeholder-garden.invalid", // .invalid never resolves
  paymentMethods: [], // e.g. ['payfast'] once wired — empty in v1
};
