// SECOND DEMO CONFIG for the Gate 3 config-swap test. Invented business,
// test contact details. To try it: copy over companyConfig.js in a scratch
// copy of the repo (never commit the swap).
export const companyConfig = {
  businessName: "Example Coastal Landscapes",
  logoUrl: "", // exercises the initials-monogram fallback
  primaryColor: "#1F4E79",
  accentColor: "#C2873B",
  currency: "ZAR",
  whatsappNumber: "27000000099",
  contactEmail: "hello@example-coastal.invalid",
  paymentMethods: [],
  timeZone: "Africa/Johannesburg",
  quoteValidityDays: 14,
  depositDefault: { type: "fixed", value: 2000 },
  paymentInstructions: "EFT to Example Coastal Landscapes, Test Bank, account 1111111111. Reference: your quote number.",
  paymentLink: "https://pay.example-coastal.invalid/quotes",
  quoteTerms: "Quoted rates valid for 14 days. Plant availability confirmed on acceptance.",
  showPoweredBy: false,
};
