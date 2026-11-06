// Pure maths and rules for the compete-pass features: option tiers, optional
// add-on items, deposits, expiry and the acceptance snapshot. No React, no
// Supabase. supabase/patches/2026-11-05-compete-upgrades.sql implements the
// same rules server-side (accept_public_quote_v2); the server is the
// authority at acceptance, this module drives the live totals on screen.
//
// All money is integer cents internally (money.js); stored values stay
// decimals rounded to the cent.
import { fromCents, percentOfCents, sumCents, toCents } from "./money.js";

export const MAX_TIERS = 3;
export const SINGLE_TIER_ID = "single";
export const DEFAULT_TIME_ZONE = "Africa/Johannesburg";

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

// A quote is tiered when it carries 2 or 3 named options. Anything else
// (null, [], one tier) is a single-option quote that uses line_items, which
// is exactly how every quote created before this pass is stored.
export function isTiered(quote) {
  return Array.isArray(quote?.tiers) && quote.tiers.length >= 2;
}

// The options the customer chooses between. A single-option quote is one
// unnamed tier so the page, PDF and maths have a single code path.
export function quoteTiers(quote) {
  if (isTiered(quote)) {
    return quote.tiers.slice(0, MAX_TIERS).map((t, i) => ({
      id: String(t.id ?? `tier-${i + 1}`),
      name: String(t.name ?? "").trim() || `Option ${i + 1}`,
      line_items: Array.isArray(t.line_items) ? t.line_items : [],
    }));
  }
  return [{ id: SINGLE_TIER_ID, name: null, line_items: Array.isArray(quote?.line_items) ? quote.line_items : [] }];
}

export function findTier(quote, tierId) {
  const tiers = quoteTiers(quote);
  if (!isTiered(quote)) return tiers[0];
  return tiers.find((t) => t.id === String(tierId)) ?? null;
}

// ---------------------------------------------------------------------------
// Optional add-ons
// ---------------------------------------------------------------------------

export const isOptional = (item) => item?.optional === true;

const lineCents = (item) => toCents(item?.total);

// Items included for a given set of ticked optional ids, in quote order.
// Required items are always in; optional ones only when ticked.
export function includedItems(items, optionalIds = []) {
  const picked = new Set((optionalIds ?? []).map(String));
  return (items ?? []).filter((it) => !isOptional(it) || picked.has(String(it.id)));
}

// Required-only total of a list (what the row's `total` stores before
// acceptance, and the "from" price of a tier).
export function baseCents(items) {
  return sumCents((items ?? []).filter((it) => !isOptional(it)).map(lineCents));
}

export function selectionCents(items, optionalIds = []) {
  return sumCents(includedItems(items, optionalIds).map(lineCents));
}

// Toggle one optional id in a selection, returning a new array. Ids that are
// not optional items of `items` are ignored, so a stale selection can't add
// a required item twice or invent one.
export function toggleOptional(items, optionalIds, id) {
  const valid = new Set((items ?? []).filter(isOptional).map((it) => String(it.id)));
  const key = String(id);
  if (!valid.has(key)) return (optionalIds ?? []).filter((x) => valid.has(String(x)));
  const cur = (optionalIds ?? []).map(String).filter((x) => valid.has(x));
  return cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
}

// Cheapest required-only tier total, for the dashboard "from" price and the
// row's stored total on a tiered quote.
export function fromPriceCents(quote) {
  const totals = quoteTiers(quote).map((t) => baseCents(t.line_items));
  return totals.length ? Math.min(...totals) : 0;
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

// deposit = { type: "percent" | "fixed", value } | null.
// Returns { depositCents, balanceCents }. Percent rounds half away from zero
// to the cent; a fixed amount is capped at the total; nonsense is no deposit.
export function depositSplit(totalCents, deposit) {
  const total = Math.max(0, Math.trunc(totalCents) || 0);
  let dep = 0;
  if (deposit && deposit.type === "percent") {
    const pctCents = toCents(deposit.value); // 50 -> 5000, reuse the decimal parser
    if (pctCents > 0) dep = percentOfCents(total, Math.min(pctCents, 10000) / 100);
  } else if (deposit && deposit.type === "fixed") {
    dep = Math.min(Math.max(0, toCents(deposit.value)), total);
  }
  return { depositCents: dep, balanceCents: total - dep };
}

// The deposit setting stored on a quote row, or null.
export function quoteDeposit(quote) {
  const type = quote?.deposit_type;
  if ((type !== "percent" && type !== "fixed") || !(toCents(quote.deposit_value) > 0)) return null;
  return { type, value: Number(quote.deposit_value) };
}

// Plain-language validation for the builder. Returns an error string or null.
export function validateDeposit(deposit, totalCents) {
  if (!deposit) return null;
  const v = toCents(deposit.value);
  if (!(v > 0)) return "Enter a deposit above 0, or switch the deposit off";
  if (deposit.type === "percent" && v > 10000) return "A percentage deposit can be at most 100%";
  if (deposit.type === "fixed" && totalCents > 0 && v > totalCents) return "The deposit can't be more than the quote total";
  return null;
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

// Today's calendar date ("YYYY-MM-DD") in the business's time zone. The SQL
// side uses the same zone (Africa/Johannesburg) for its server-side check.
export function todayInZone(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const OPEN_STATUSES = ["draft", "sent", "viewed"];

// valid_until is inclusive: a quote valid until 2026-11-30 can be accepted
// all of the 30th and is expired from midnight on the 1st.
export function isExpired(quote, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const until = normaliseDate(quote?.valid_until);
  if (!until || !OPEN_STATUSES.includes(quote.status)) return false;
  return todayInZone(now, timeZone) > until;
}

// Status as the owner should read it: "expired" overrides an open status.
export function displayStatus(quote, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return isExpired(quote, now, timeZone) ? "expired" : quote?.status ?? "draft";
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`); // midday UTC: no DST/zone edge
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function defaultValidUntil(days, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  if (!(days > 0)) return "";
  return addDays(todayInZone(now, timeZone), days);
}

function normaliseDate(v) {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Acceptance snapshot
// ---------------------------------------------------------------------------

// What acceptance freezes: the chosen tier, the included items (optional
// ones the customer ticked, flagged as such), totals and the deposit split.
// Mirrors accept_public_quote_v2. Returns { error } for an unknown tier.
export function buildAcceptanceSnapshot(quote, { tierId = null, optionalIds = [] } = {}) {
  const tier = isTiered(quote) ? findTier(quote, tierId) : quoteTiers(quote)[0];
  if (!tier) return { error: "invalid_tier" };
  const items = includedItems(tier.line_items, optionalIds);
  const totalCents = sumCents(items.map(lineCents));
  const deposit = quoteDeposit(quote);
  const { depositCents, balanceCents } = depositSplit(totalCents, deposit);
  const chosenOptional = items.filter(isOptional).map((it) => String(it.id));
  return {
    snapshot: {
      tier_id: isTiered(quote) ? tier.id : null,
      tier_name: isTiered(quote) ? tier.name : null,
      line_items: items,
      optional_ids: chosenOptional,
      subtotal: fromCents(totalCents),
      total: fromCents(totalCents),
      deposit_type: deposit?.type ?? null,
      deposit_value: deposit?.value ?? null,
      deposit_amount: fromCents(depositCents),
      balance_amount: fromCents(balanceCents),
    },
  };
}

// The document to render once a quote is accepted (or invoiced/paid): the
// frozen snapshot when there is one, otherwise the legacy record as-is
// (quotes accepted before this pass have no snapshot).
export function acceptedDocument(quote) {
  const s = quote?.accepted_selection;
  if (s && Array.isArray(s.line_items)) {
    const totalCents = toCents(s.total);
    return {
      tierName: s.tier_name ?? null,
      line_items: s.line_items,
      subtotal: s.subtotal,
      total: s.total,
      deposit: s.deposit_type ? { depositCents: toCents(s.deposit_amount), balanceCents: toCents(s.balance_amount) } : null,
      totalCents,
    };
  }
  const items = Array.isArray(quote?.line_items) ? quote.line_items : [];
  const totalCents = toCents(quote?.total);
  const deposit = quoteDeposit(quote);
  return {
    tierName: null,
    line_items: items,
    subtotal: quote?.subtotal,
    total: quote?.total,
    deposit: deposit ? depositSplit(totalCents, deposit) : null,
    totalCents,
  };
}

export const ACCEPTED_STATUSES = ["accepted", "invoiced", "paid"];
export const isAcceptedStatus = (status) => ACCEPTED_STATUSES.includes(status);

// Customer-side validation of the typed-name acceptance.
export function validateAcceptance({ fullName, consent }) {
  const errors = {};
  const name = String(fullName ?? "").trim();
  if (name.length < 2) errors.fullName = "Type your full name to accept";
  else if (name.length > 120) errors.fullName = "Use 120 characters or fewer";
  if (consent !== true) errors.consent = "Tick the box to confirm you accept";
  return errors;
}

// ---------------------------------------------------------------------------
// Follow-up + timeline
// ---------------------------------------------------------------------------

// A one-tap WhatsApp follow-up makes sense while the customer can still act.
export function canFollowUp(quote, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return (quote?.status === "sent" || quote?.status === "viewed") && !isExpired(quote, now, timeZone);
}

const STATUS_RANK = { draft: 0, sent: 1, viewed: 2, accepted: 3, invoiced: 4, paid: 5 };

// Steps for the quote detail timeline: created -> sent -> viewed ->
// accepted | expired (-> invoiced -> paid once they happen). Each step is
// { key, label, at (ISO or null), state: "done" | "current" | "todo" | "bad" }.
// A step reached without a recorded time (quotes sent before sent_at existed)
// is "done" with at = null, and the UI says the time wasn't recorded.
export function buildTimeline(quote, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const rank = STATUS_RANK[quote?.status] ?? 0;
  const expired = isExpired(quote, now, timeZone);
  const steps = [
    { key: "created", label: "Created", at: quote?.created_at ?? null, reached: true },
    { key: "sent", label: "Sent", at: quote?.sent_at ?? null, reached: rank >= 1 },
    { key: "viewed", label: "Viewed by customer", at: quote?.viewed_at ?? null, reached: rank >= 2 || Boolean(quote?.viewed_at) },
  ];
  if (expired) {
    steps.push({ key: "expired", label: "Expired", at: quote.valid_until, reached: true, bad: true });
  } else {
    steps.push({ key: "accepted", label: "Accepted", at: quote?.accepted_at ?? null, reached: rank >= 3 });
    if (rank >= 4) steps.push({ key: "invoiced", label: "Invoiced", at: quote.invoiced_at ?? null, reached: true });
    if (rank >= 5) steps.push({ key: "paid", label: "Paid", at: quote.paid_at ?? null, reached: true });
  }
  const lastReached = steps.map((s) => s.reached).lastIndexOf(true);
  return steps.map((s, i) => ({
    key: s.key,
    label: s.label,
    at: s.at,
    state: s.bad ? "bad" : s.reached ? (i === lastReached ? "current" : "done") : "todo",
  }));
}
