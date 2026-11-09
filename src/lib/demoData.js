// One-click demo data. Seeds sample quotes and a starter item library for
// the SIGNED-IN business only, through the normal authenticated client, so
// RLS decides what it can touch. Every seeded row carries is_demo = true;
// removal deletes rows that are is_demo AND owned by the caller, nothing
// else. Contact details are test values (+2700000000x, @example.com), and
// every surface shows a Demo pill (app) or a "demo quote" note (customer
// page, PDF), so a seeded row can never be mistaken for a real customer.
import { computeTotal, newLineItem, serialiseLineItem } from "./lineItems.js";
import { fromCents } from "./money.js";
import { addDays, baseCents, buildAcceptanceSnapshot, fromPriceCents, todayInZone } from "./quoteMath.js";

export const DEMO_FLAG = "is_demo";

export const isDemoRow = (row) => row?.[DEMO_FLAG] === true;

// Starter library for a landscaping business. Rates are illustrative
// defaults the owner is expected to edit, not market data.
export const STARTER_LIBRARY = [
  { name: "Instant lawn (Kikuyu)", description: "Supplied and laid on prepared soil", mode: "area", default_rate: 85 },
  { name: "Lawn preparation", description: "Clear, level and add topsoil", mode: "area", default_rate: 45 },
  { name: "Paving (cement pavers)", description: "Laid on a compacted base", mode: "area", default_rate: 320 },
  { name: "Compost delivery", description: "Per 6 m³ load", mode: "load", default_rate: 1250 },
  { name: "Rubble removal", description: "Per bakkie load, legal dump site", mode: "load", default_rate: 650 },
  { name: "Agapanthus (4 L bag)", description: "Supplied and planted", mode: "unit", default_rate: 75 },
  { name: "Bark mulch (bag)", description: "Spread on beds", mode: "unit", default_rate: 95 },
  { name: "Garden labour, 2-person team", description: "Per working day", mode: "day", default_rate: 1800 },
  { name: "Tree felling (small tree)", description: "Including removal of branches", mode: "plain", default_rate: 1500 },
  { name: "Call-out and site assessment", description: "", mode: "plain", default_rate: 350 },
];

const item = (mode, description, qty, rate, extra = {}) => {
  const it = { ...newLineItem(mode), description, qty: mode === "plain" ? 1 : String(qty), rate: String(rate), ...extra };
  it.total = computeTotal(it);
  return serialiseLineItem(it);
};

const iso = (now, daysAgo, hour = 9) => {
  const d = new Date(now.getTime() - daysAgo * 86400000);
  d.setUTCHours(hour - 2, 0, 0, 0); // ~local SAST morning
  return d.toISOString();
};

// Rows for the quotes table, ready to insert. owner_id is left to the
// column default (auth.uid()), so the seed can only ever write as the
// signed-in user. `now` is injectable for tests.
export function buildDemoQuotes(now = new Date()) {
  const today = todayInZone(now);
  const base = (q) => {
    const tiered = Array.isArray(q.tiers) && q.tiers.length >= 2;
    const items = tiered ? q.tiers[0].line_items : q.line_items;
    const total = fromCents(tiered ? fromPriceCents(q) : baseCents(items));
    return {
      customer_phone: null,
      customer_email: null,
      tiers: null,
      deposit_type: null,
      deposit_value: null,
      valid_until: null,
      ...q,
      line_items: items,
      subtotal: total,
      total,
      [DEMO_FLAG]: true,
    };
  };

  const quotes = [];

  // 1. Draft, still being built
  quotes.push(base({
    customer_name: "Lerato K.",
    customer_phone: "+27000000001",
    status: "draft",
    created_at: iso(now, 0, 8),
    line_items: [
      item("day", "Garden clean-up, 2-person team", 1, 1800),
      item("load", "Garden refuse removal", 1, 650),
    ],
  }));

  // 2. Sent, with a 50% deposit
  quotes.push(base({
    customer_name: "Pieter V.",
    customer_phone: "+27000000002",
    customer_email: "demo2@example.com",
    status: "sent",
    created_at: iso(now, 2),
    sent_at: iso(now, 2, 10),
    valid_until: addDays(today, 28),
    deposit_type: "percent",
    deposit_value: 50,
    line_items: [
      item("area", "Paving, driveway extension", 24, 320, { detail: "Cement pavers on a compacted base" }),
      item("load", "Rubble removal", 2, 650),
    ],
  }));

  // 3. Viewed, three option tiers
  const tierQuote = {
    customer_name: "Ayesha D.",
    customer_phone: "+27000000003",
    status: "viewed",
    created_at: iso(now, 3),
    sent_at: iso(now, 3, 11),
    viewed_at: iso(now, 1, 18),
    valid_until: addDays(today, 21),
    tiers: [
      { id: "good", name: "Good", line_items: [
        item("area", "Instant lawn (Kikuyu)", 40, 85),
        item("area", "Lawn preparation", 40, 45),
      ] },
      { id: "better", name: "Better", line_items: [
        item("area", "Instant lawn (Kikuyu)", 40, 85),
        item("area", "Lawn preparation", 40, 45),
        item("unit", "Agapanthus border (4 L bags)", 20, 75),
      ] },
      { id: "best", name: "Best", line_items: [
        item("area", "Instant lawn (Kikuyu)", 40, 85),
        item("area", "Lawn preparation", 40, 45),
        item("unit", "Agapanthus border (4 L bags)", 20, 75),
        item("unit", "Bark mulch on beds", 12, 95),
        item("day", "Irrigation, 4-zone drip system", 2, 1800),
      ] },
    ],
  };
  quotes.push(base(tierQuote));

  // 4. Viewed, with optional add-ons
  quotes.push(base({
    customer_name: "Johan B.",
    customer_phone: "+27000000004",
    status: "viewed",
    created_at: iso(now, 5),
    sent_at: iso(now, 5, 12),
    viewed_at: iso(now, 4, 19),
    valid_until: addDays(today, 14),
    line_items: [
      item("plain", "Tree felling, dead jacaranda", 1, 1500),
      item("load", "Branch and stump removal", 1, 650),
      item("plain", "Stump grinding", 1, 900, { optional: true }),
      item("unit", "Replacement tree (Wild Olive, 50 L)", 1, 1200, { optional: true }),
    ],
  }));

  // 5. Accepted: tier-free, optional add-on taken, 30% deposit, typed name
  const accepted = base({
    customer_name: "Nomsa T.",
    customer_phone: "+27000000005",
    status: "accepted",
    created_at: iso(now, 9),
    sent_at: iso(now, 9, 10),
    viewed_at: iso(now, 8, 20),
    accepted_at: iso(now, 7, 8),
    deposit_type: "percent",
    deposit_value: 30,
    line_items: [
      item("area", "Instant lawn (Kikuyu)", 60, 85),
      item("load", "Compost delivery", 1, 1250),
      item("unit", "Bark mulch on beds", 10, 95, { optional: true }),
    ],
  });
  const snap = buildAcceptanceSnapshot(accepted, { optionalIds: [accepted.line_items[2].id] }).snapshot;
  Object.assign(accepted, {
    accepted_name: "Nomsa T.",
    accepted_consent: true,
    accepted_tier_id: null,
    accepted_selection: snap,
    subtotal: snap.subtotal,
    total: snap.total,
  });
  quotes.push(accepted);

  // 6. Expired: sent, never accepted, valid-until in the past
  quotes.push(base({
    customer_name: "Ruan S.",
    customer_phone: "+27000000006",
    status: "sent",
    created_at: iso(now, 40),
    sent_at: iso(now, 40, 10),
    valid_until: addDays(today, -10),
    line_items: [
      item("area", "Artificial turf, play area", 18, 390),
      item("day", "Labour, 2-person team", 1, 1800),
    ],
  }));

  // 7. Invoiced
  const invoiced = base({
    customer_name: "Grace M.",
    customer_phone: "+27000000007",
    status: "invoiced",
    created_at: iso(now, 21),
    sent_at: iso(now, 21, 10),
    viewed_at: iso(now, 20, 9),
    accepted_at: iso(now, 19, 14),
    invoiced_at: iso(now, 6, 16),
    line_items: [
      item("day", "Monthly garden maintenance", 4, 1100),
      item("load", "Garden refuse removal", 2, 650),
    ],
  });
  const snap7 = buildAcceptanceSnapshot(invoiced).snapshot;
  Object.assign(invoiced, { accepted_name: "Grace M.", accepted_consent: true, accepted_selection: snap7 });
  quotes.push(invoiced);

  return quotes;
}

export function buildDemoLibrary() {
  return STARTER_LIBRARY.map((e) => ({ ...e, [DEMO_FLAG]: true }));
}

// Seed. Refuses to double-seed: if this owner already has demo rows, it
// returns { skipped: true } and changes nothing.
export async function loadDemoData(client, ownerId, now = new Date()) {
  if (!ownerId) throw new Error("Sign in first");
  const existing = await client.from("quotes").select("id").eq(DEMO_FLAG, true).eq("owner_id", ownerId).limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length > 0) return { skipped: true, quotes: 0, library: 0 };

  const quotes = buildDemoQuotes(now);
  const q = await client.from("quotes").insert(quotes).select("id");
  if (q.error) throw q.error;
  const lib = await client.from("quote_library_items").insert(buildDemoLibrary()).select("id");
  if (lib.error) throw lib.error;
  return { skipped: false, quotes: q.data?.length ?? 0, library: lib.data?.length ?? 0 };
}

// Remove exactly what was seeded: is_demo rows owned by this user. Both
// filters are always applied, so a staff login that can see other owners'
// quotes under RLS still can't delete them here.
export async function removeDemoData(client, ownerId) {
  if (!ownerId) throw new Error("Sign in first");
  const q = await client.from("quotes").delete().eq(DEMO_FLAG, true).eq("owner_id", ownerId).select("id");
  if (q.error) throw q.error;
  const lib = await client.from("quote_library_items").delete().eq(DEMO_FLAG, true).eq("owner_id", ownerId).select("id");
  if (lib.error) throw lib.error;
  return { quotes: q.data?.length ?? 0, library: lib.data?.length ?? 0 };
}
