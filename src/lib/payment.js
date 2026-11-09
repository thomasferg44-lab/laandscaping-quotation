// Payment details shown to the customer: bank/EFT text and an optional
// payment link from companyConfig. No payment processing.

// Only plain https links are ever rendered or printed.
export function safePaymentLink(link) {
  if (typeof link !== "string" || !link.trim()) return null;
  try {
    const u = new URL(link.trim());
    return u.protocol === "https:" && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

// What the payment block shows for this quote, or null for nothing to show
// (no details configured, or already paid).
export function paymentBlock(config, quote, ref) {
  const instructions = typeof config?.paymentInstructions === "string" ? config.paymentInstructions.trim() : "";
  const link = safePaymentLink(config?.paymentLink);
  if (!instructions && !link) return null;
  if (quote?.status === "paid") return null;
  const open = quote?.status === "draft" || quote?.status === "sent" || quote?.status === "viewed";
  return {
    title: open ? "Payment details" : "How to pay",
    note: open ? "Pay once you've accepted this quote." : null,
    instructions: instructions || null,
    link,
    reference: ref,
  };
}
