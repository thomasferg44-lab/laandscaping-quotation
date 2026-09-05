// Single source of truth for "is this record a quote or an invoice?".
// Used by the public page, the builder and the PDF so they never disagree.
export function isInvoiceStatus(status) {
  return status === "invoiced" || status === "paid";
}

export function docLabel(status) {
  return isInvoiceStatus(status) ? "Invoice" : "Quote";
}

// Short human reference derived from the uuid, e.g. "Q-3F2A9C". Stable per
// record, no extra column needed.
export function docRef(quote) {
  return `${isInvoiceStatus(quote.status) ? "INV" : "Q"}-${String(quote.id).slice(0, 6).toUpperCase()}`;
}
