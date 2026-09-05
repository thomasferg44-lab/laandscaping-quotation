// Pure helpers for line items. No React, no Supabase.
// A line item is: { id, description, mode, qty, rate, total, photo_url }
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
  };
}

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function computeTotal(item) {
  const qty = item.mode === "plain" ? 1 : num(item.qty);
  return round2(qty * num(item.rate));
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Human-readable breakdown shown under the description, e.g. "40 m² × R85.00".
export function describeCalc(item, formatMoney) {
  if (item.mode === "plain") return null;
  const m = MODES[item.mode];
  const qty = num(item.qty);
  if (!qty || !num(item.rate)) return null;
  return `${qty} ${m.unit} × ${formatMoney(num(item.rate))}`;
}

export function sumLineItems(items) {
  return round2(items.reduce((acc, it) => acc + num(it.total), 0));
}

// Normalise for storage: numbers, not strings, and a recomputed total.
export function serialiseLineItem(item) {
  return {
    id: item.id,
    description: item.description.trim(),
    mode: item.mode,
    qty: item.mode === "plain" ? 1 : num(item.qty),
    rate: num(item.rate),
    total: computeTotal(item),
    photo_url: item.photo_url || null,
  };
}

export function makeMoneyFormatter(currency) {
  const fmt = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  });
  return (n) => fmt.format(num(n));
}
