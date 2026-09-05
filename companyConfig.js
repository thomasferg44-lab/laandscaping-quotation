// Per-client white-label config. This is the ONLY place client-specific,
// non-secret data lives. Swap this file per deploy. Secrets go in .env.
export const companyConfig = {
  businessName: "Example Landscaping",
  logoUrl: "/logo.png",
  primaryColor: "#2F5233",
  accentColor: "#8B6F47",
  currency: "ZAR",
  whatsappNumber: "27000000000", // landscaper's own number, digits only, no +
  contactEmail: "quotes@example.com",
  paymentMethods: [], // e.g. ['payfast'] once wired — empty in v1
};
