import { companyConfig } from "../../companyConfig.js";

// Pure URL builders for the three share buttons. No React, no Supabase.

export function buildQuoteUrl(id, origin = window.location.origin) {
  return `${origin}/quote/${id}`;
}

// Normalise a South African number for wa.me: digits only, international
// format without "+". Accepts "082 123 4567", "+27 82 123 4567", "27821234567".
// Returns null if it doesn't look like a usable mobile number.
export function normaliseWhatsAppNumber(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = "27" + d.slice(1);
  if (d.length === 9 && !d.startsWith("0")) d = "27" + d; // "821234567"
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

export function buildShareMessage({ customerName, quoteUrl }) {
  const name = customerName?.trim();
  return [
    `Hi${name ? ` ${name}` : ""},`,
    "",
    `Here is your quote from ${companyConfig.businessName}:`,
    quoteUrl,
    "",
    "You can view it and accept it online from that link.",
    "",
    `Thanks,`,
    companyConfig.businessName,
  ].join("\n");
}

export function buildWhatsAppUrl({ phone, message }) {
  const n = normaliseWhatsAppNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}

export function buildMailtoUrl({ email, subject, body }) {
  const e = email?.trim();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  const q = new URLSearchParams({ subject, body });
  // URLSearchParams encodes spaces as "+", which mail clients render literally.
  return `mailto:${e}?${q.toString().replace(/\+/g, "%20")}`;
}

export function buildShareLinks(quote) {
  const quoteUrl = buildQuoteUrl(quote.id);
  const message = buildShareMessage({ customerName: quote.customer_name, quoteUrl });
  return {
    quoteUrl,
    whatsapp: buildWhatsAppUrl({ phone: quote.customer_phone, message }),
    mailto: buildMailtoUrl({
      email: quote.customer_email,
      subject: `Quote from ${companyConfig.businessName}`,
      body: message,
    }),
  };
}

// One-tap WhatsApp follow-up for a sent/viewed quote the customer hasn't
// accepted. Manual only: this builds a wa.me link, the owner taps send.
export function buildFollowUpMessage({ customerName, ref, totalText, quoteUrl }) {
  const name = customerName?.trim();
  return [
    `Hi${name ? ` ${name}` : ""},`,
    "",
    `Just following up on quote ${ref} from ${companyConfig.businessName} for ${totalText}.`,
    "You can view it and accept it here:",
    quoteUrl,
    "",
    "Let me know if you have any questions.",
    "",
    "Thanks,",
    companyConfig.businessName,
  ].join("\n");
}

export function buildFollowUpUrl({ quote, ref, totalText, origin }) {
  const quoteUrl = buildQuoteUrl(quote.id, origin);
  return buildWhatsAppUrl({
    phone: quote.customer_phone,
    message: buildFollowUpMessage({ customerName: quote.customer_name, ref, totalText, quoteUrl }),
  });
}
