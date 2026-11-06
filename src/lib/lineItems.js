// Pure helpers for line items. No React, no Supabase.
import { fromCents, fromQtyMilli, makeCentsFormatter, multiplyCents, sumCents, toCents, toQtyMilli } from "./money.js";

// A line item is: { id, description, mode, qty, rate, total, photo_url,
//                   detail?, optional? }
// detail is an optional quiet second line (e.g. from the item library);
// optional marks a customer-toggled add-on (see quoteMath.js).
// mode is one of MODES below. The mode is only a calculator UI on top of
// qty × rate; every mode collapses to the same shape in the database.

export const MODES = {
  plain: { label: "Plain", qtyLabel: null, rateLabel: "Amount", unit: "" },
  area:  { label: "Area (m²)", qtyLabel: "Area (m²)", rateLabel: "Rate per m²", unit: "m²" },
  unit:  { label: "Per unit", qtyLabel: "Quantity", rateLabel: "Rate per unit", unit: "units" },
  load:  { label: "Per load", qtyLabel: "Loads", rateLabel: "Rate per load", unit: "loads" },
  day:   { label: "Day-rate labour", qtyLabel: "Days", rateLabel: "Day rate", unit: "days" },
};

export const MODE_KEYS = Object.keys(MODES);

export function newLineItem(mode = "plain") {
  return {
    id: crypto.randomUUID(),
    description: "",
    mode,
    qty: mode === "plain" ? 1 : "",
    rate: "",
    total: 0,
    photo_url: null,
    detail: "",
    optional: false,
  };
}

// A builder line item pre-filled from an item-library entry.
export function lineItemFromLibrary(entry) {
  const mode = MODES[entry.mode] ? entry.mode : "unit";
  const item = {
    ...newLineItem(mode),
    description: entry.name ?? "",
    detail: entry.description ?? "",
    rate: entry.default_rate == null ? "" : String(entry.default_rate),
  };
  if (mode === "plain") item.total = computeTotal(item);
  return item;
}

// Quantities are not money, but parse them the same way (decimal comma ok).
const qtyOf = (item) => (item.mode === "plain" ? 1 : fromQtyMilli(toQtyMilli(item.qty)));

// Line total as a stored decimal. The maths is qty × rate in integer cents
// (see money.js); only the result is converted back.
export function computeTotal(item) {
  return fromCents(itemTotalCents(item));
}

export function itemTotalCents(item) {
  return multiplyCents(item.mode === "plain" ? 1 : item.qty, item.rate);
}

// Human-readable breakdown shown under the description, e.g. "40 m² × R85.00".
export function describeCalc(item, formatMoney) {
  if (item.mode === "plain") return null;
  const m = MODES[item.mode];
  const qty = qtyOf(item);
  if (!qty || !toCents(item.rate)) return null;
  return `${qty} ${m.unit} × ${formatMoney(item.rate)}`;
}

// Sums the saved per-line totals (what the customer sees per line), in cents.
export function sumLineItems(items) {
  return fromCents(sumCents(items.map((it) => toCents(it.total))));
}

// Normalise for storage: numbers, not strings, rate rounded to the cent and a
// recomputed total.
export function serialiseLineItem(item) {
  return {
    id: item.id,
    description: item.description.trim(),
    mode: item.mode,
    qty: qtyOf(item),
    rate: fromCents(toCents(item.rate)),
    total: computeTotal(item),
    photo_url: item.photo_url || null,
    ...(item.detail?.trim() ? { detail: item.detail.trim() } : {}),
    ...(item.optional ? { optional: true } : {}),
  };
}

// Builder-side validation for one line item. Returns { field: message }.
// Blank rows (no description, no amount) are dropped on save, not errors.
export function validateLineItem(item) {
  const errors = {};
  const blank = !item.description?.trim() && !toCents(item.rate);
  if (blank) return errors;
  if (!item.description?.trim()) errors.description = "Describe the work, e.g. Lay instant lawn";
  if (item.mode !== "plain" && !(toQtyMilli(item.qty) > 0)) {
    errors.qty = `Enter ${MODES[item.mode].qtyLabel.toLowerCase()} above 0`;
  }
  if (!(toCents(item.rate) > 0)) errors.rate = item.mode === "plain" ? "Enter an amount above 0" : "Enter a rate above 0";
  return errors;
}

// Steppers: +/- 1 on the quantity, never below 0, keeping decimals typed.
export function stepQty(qty, delta) {
  const milli = toQtyMilli(qty) + delta * 1000;
  return String(fromQtyMilli(Math.max(0, milli)));
}

// Formats a stored decimal (or user input) for display, via integer cents.
export function makeMoneyFormatter(currency) {
  const fmt = makeCentsFormatter(currency);
  return (n) => fmt(toCents(n));
}
