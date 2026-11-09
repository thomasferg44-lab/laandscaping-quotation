// Builder form <-> database row. Pure: no React, no Supabase.
//
// Form shape:
//   { customer_name, customer_phone, customer_email,
//     tiered, tiers: [{ id, name, line_items }], line_items,
//     depositOn, deposit: { type, value }, valid_until ("" | "YYYY-MM-DD") }
//
// The compete-pass columns (tiers, deposit_*, valid_until) are only sent when
// they carry a value or the loaded row already had them. So a plain
// single-option quote still saves on a database the 2026-11-05 patch hasn't
// reached yet, and clearing a value on a patched row still writes null.
import { newLineItem, serialiseLineItem, validateLineItem } from "./lineItems.js";
import { fromCents, sumCents, toCents } from "./money.js";
import { baseCents, MAX_TIERS, todayInZone, validateDeposit } from "./quoteMath.js";

const NEW_COLUMNS = ["tiers", "deposit_type", "deposit_value", "valid_until"];
const TIER_NAMES = ["Good", "Better", "Best"];

export const shortId = () => `t-${crypto.randomUUID().slice(0, 8)}`;

const isBlank = (it) => !it.description?.trim() && !toCents(it.rate);
const keepItems = (items) => items.filter((it) => !isBlank(it)).map(serialiseLineItem);

export function emptyForm(config, now = new Date()) {
  const dep = config.depositDefault;
  const days = Number(config.quoteValidityDays) || 0;
  return {
    customer_name: "", customer_phone: "", customer_email: "",
    tiered: false, tiers: [], line_items: [newLineItem("area")],
    depositOn: Boolean(dep && dep.value > 0),
    deposit: { type: dep?.type === "fixed" ? "fixed" : "percent", value: dep?.value ? String(dep.value) : "50" },
    valid_until: days > 0 ? addDaysLocal(todayInZone(now, config.timeZone), days) : "",
    status: "draft",
  };
}

function addDaysLocal(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Database row -> form.
export function formFromRow(row, config) {
  const tiered = Array.isArray(row.tiers) && row.tiers.length >= 2;
  const hasDep = (row.deposit_type === "percent" || row.deposit_type === "fixed") && toCents(row.deposit_value) > 0;
  const dep = config.depositDefault;
  return {
    ...row,
    customer_phone: row.customer_phone ?? "",
    customer_email: row.customer_email ?? "",
    tiered,
    tiers: tiered ? row.tiers.map((t) => ({ id: t.id, name: t.name ?? "", line_items: t.line_items ?? [] })) : [],
    line_items: tiered ? [] : (row.line_items?.length ? row.line_items : [newLineItem("area")]),
    depositOn: hasDep,
    deposit: hasDep
      ? { type: row.deposit_type, value: String(row.deposit_value) }
      : { type: dep?.type === "fixed" ? "fixed" : "percent", value: dep?.value ? String(dep.value) : "50" },
    valid_until: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
  };
}

// Turn a single-option form into 2 tiers (Good = current items, Better = a
// copy with fresh ids), or add one more tier (max 3).
export function addTier(form) {
  if (!form.tiered) {
    const items = form.line_items.length ? form.line_items : [newLineItem("area")];
    return {
      ...form, tiered: true, line_items: [],
      tiers: [
        { id: shortId(), name: TIER_NAMES[0], line_items: items },
        { id: shortId(), name: TIER_NAMES[1], line_items: items.map((it) => ({ ...it, id: crypto.randomUUID() })) },
      ],
    };
  }
  if (form.tiers.length >= MAX_TIERS) return form;
  const last = form.tiers[form.tiers.length - 1];
  return {
    ...form,
    tiers: [...form.tiers, { id: shortId(), name: TIER_NAMES[form.tiers.length] ?? `Option ${form.tiers.length + 1}`,
      line_items: last.line_items.map((it) => ({ ...it, id: crypto.randomUUID() })) }],
  };
}

// Remove a tier. Dropping to one tier collapses back to a single-option
// quote holding the remaining tier's items.
export function removeTier(form, tierId) {
  const rest = form.tiers.filter((t) => t.id !== tierId);
  if (rest.length >= 2) return { ...form, tiers: rest };
  return { ...form, tiered: false, tiers: [], line_items: rest[0]?.line_items ?? [newLineItem("area")] };
}

export function buildQuotePayload(form, { known = {}, now = new Date(), timeZone } = {}) {
  const errors = {};
  const itemErrors = {};
  const tierErrors = {};

  if (!form.customer_name?.trim()) errors.customer_name = "Enter the customer's name";
  const email = form.customer_email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.customer_email = "Enter an email like name@example.com, or leave it blank";

  const checkItems = (items) => { for (const it of items) { const e = validateLineItem(it); if (Object.keys(e).length) itemErrors[it.id] = e; } };

  let line_items, tiers = null, totalCents;
  if (form.tiered) {
    tiers = form.tiers.slice(0, MAX_TIERS).map((t) => {
      checkItems(t.line_items);
      const items = keepItems(t.line_items);
      if (!t.name?.trim()) tierErrors[t.id] = "Give this option a name, e.g. Better";
      else if (items.length === 0) tierErrors[t.id] = "Add at least one item to this option";
      return { id: t.id, name: t.name.trim(), line_items: items };
    });
    const names = tiers.map((t) => t.name.toLowerCase());
    tiers.forEach((t, i) => { if (t.name && names.indexOf(t.name.toLowerCase()) !== i) tierErrors[t.id] = "Each option needs a different name"; });
    line_items = tiers[0]?.line_items ?? [];
    totalCents = Math.min(...tiers.map((t) => baseCents(t.line_items)));
  } else {
    checkItems(form.line_items);
    line_items = keepItems(form.line_items);
    if (line_items.length === 0 && !Object.keys(itemErrors).length) errors.items = "Add at least one line item with a description and amount";
    totalCents = baseCents(line_items);
  }

  const deposit = form.depositOn ? { type: form.deposit.type, value: form.deposit.value } : null;
  const depErr = validateDeposit(deposit, totalCents);
  if (depErr) errors.deposit = depErr;

  const until = form.valid_until || null;
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) errors.valid_until = "Pick a date";
  else if (until && until < todayInZone(now, timeZone) && until !== known.valid_until_original) {
    errors.valid_until = "That date has passed. Pick a later date or clear it";
  }

  if (Object.keys(itemErrors).length) errors.itemErrors = itemErrors;
  if (Object.keys(tierErrors).length) errors.tierErrors = tierErrors;

  const total = fromCents(totalCents);
  const payload = {
    customer_name: form.customer_name?.trim() ?? "",
    customer_phone: form.customer_phone?.trim() || null,
    customer_email: email || null,
    line_items,
    subtotal: total,
    total,
  };
  const extra = {
    tiers,
    deposit_type: deposit ? deposit.type : null,
    deposit_value: deposit ? fromCents(toCents(deposit.value)) : null,
    valid_until: until,
  };
  for (const k of NEW_COLUMNS) if (extra[k] != null || known[k]) payload[k] = extra[k];

  return { payload, errors: Object.keys(errors).length ? errors : null };
}

// Live total for the sticky bar: base total, or "from" the cheapest tier.
export function formTotalCents(form) {
  if (form.tiered) return Math.min(...form.tiers.map((t) => baseCents(t.line_items.filter((it) => !isBlank(it)))));
  return baseCents(form.line_items.filter((it) => !isBlank(it)));
}

export function formOptionalCents(form, tierIndex = 0) {
  const items = form.tiered ? form.tiers[tierIndex]?.line_items ?? [] : form.line_items;
  return sumCents(items.filter((it) => it.optional).map((it) => toCents(it.total)));
}
