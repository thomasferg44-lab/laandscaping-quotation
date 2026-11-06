// Item library entry validation (pure).
import { MODES } from "./lineItems.js";
import { fromCents, toCents } from "./money.js";

export function validateLibraryEntry(e) {
  const errors = {};
  if (!e.name?.trim()) errors.name = "Name the item, e.g. Instant lawn (Kikuyu)";
  else if (e.name.trim().length > 120) errors.name = "Use 120 characters or fewer";
  if (!MODES[e.mode]) errors.mode = "Choose how this item is priced";
  if (!(toCents(e.rate) > 0)) errors.rate = "Enter a default rate above 0";
  return Object.keys(errors).length ? errors : null;
}

export function libraryEntryFromLineItem(item) {
  return { name: item.description?.trim() ?? "", description: item.detail?.trim() ?? "", mode: item.mode, rate: item.rate === "" ? "" : String(item.rate) };
}

export const toLibraryRow = (e) => ({ ...e, default_rate: fromCents(toCents(e.rate)) });
