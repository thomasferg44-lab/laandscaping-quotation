import { describe, expect, it } from "vitest";
import {
  acceptedDocument,
  baseCents,
  buildAcceptanceSnapshot,
  buildTimeline,
  canFollowUp,
  defaultValidUntil,
  depositSplit,
  displayStatus,
  fromPriceCents,
  includedItems,
  isExpired,
  isTiered,
  quoteDeposit,
  quoteTiers,
  selectionCents,
  SINGLE_TIER_ID,
  todayInZone,
  toggleOptional,
  validateAcceptance,
  validateDeposit,
} from "./quoteMath.js";
import { stepQty, validateLineItem, lineItemFromLibrary, serialiseLineItem, newLineItem } from "./lineItems.js";
import { percentOfCents } from "./money.js";

const li = (id, total, extra = {}) => ({ id, description: id, mode: "plain", qty: 1, rate: total, total, ...extra });

const tiered = {
  status: "sent",
  line_items: [li("a", 100)],
  tiers: [
    { id: "good", name: "Good", line_items: [li("a", 1000), li("b", 250.5)] },
    { id: "better", name: "Better", line_items: [li("a", 1000), li("b", 250.5), li("c", 0.1), li("x", 99.99, { optional: true })] },
    { id: "best", name: " ", line_items: [li("a", 1000), li("d", 2000.2)] },
  ],
};

describe("tier totals", () => {
  it("treats a quote without tiers as one unnamed tier (backward compatible)", () => {
    const q = { line_items: [li("a", 10)] };
    expect(isTiered(q)).toBe(false);
    expect(quoteTiers(q)).toEqual([{ id: SINGLE_TIER_ID, name: null, line_items: q.line_items }]);
    expect(isTiered({ tiers: [] })).toBe(false);
    expect(isTiered({ tiers: [{ id: "x", line_items: [] }] })).toBe(false);
    expect(isTiered(null)).toBe(false);
  });

  it("totals each tier in cents with no float drift", () => {
    const totals = quoteTiers(tiered).map((t) => baseCents(t.line_items));
    expect(totals).toEqual([125050, 125060, 300020]);
  });

  it("names a blank tier by position", () => {
    expect(quoteTiers(tiered)[2].name).toBe("Option 3");
  });

  it("the from-price is the cheapest tier, ignoring optional items", () => {
    expect(fromPriceCents(tiered)).toBe(125050);
    expect(fromPriceCents({ line_items: [li("a", 10), li("o", 5, { optional: true })] })).toBe(1000);
  });

  it("caps at 3 tiers", () => {
    const four = { tiers: [1, 2, 3, 4].map((n) => ({ id: `t${n}`, name: `T${n}`, line_items: [] })) };
    expect(quoteTiers(four)).toHaveLength(3);
  });
});

describe("optional add-ons", () => {
  const items = [li("req1", 100), li("opt1", 50.25, { optional: true }), li("req2", 0.1), li("opt2", 0.2, { optional: true })];

  it("required items are always in, optional only when ticked", () => {
    expect(includedItems(items, []).map((i) => i.id)).toEqual(["req1", "req2"]);
    expect(includedItems(items, ["opt2"]).map((i) => i.id)).toEqual(["req1", "req2", "opt2"]);
  });

  it("recalculates the total exactly as items toggle", () => {
    expect(selectionCents(items, [])).toBe(10010);
    expect(selectionCents(items, ["opt1"])).toBe(15035);
    expect(selectionCents(items, ["opt1", "opt2"])).toBe(15055);
  });

  it("toggle adds then removes, and ignores ids that aren't optional", () => {
    let sel = [];
    sel = toggleOptional(items, sel, "opt1");
    expect(sel).toEqual(["opt1"]);
    sel = toggleOptional(items, sel, "opt2");
    expect(sel).toEqual(["opt1", "opt2"]);
    sel = toggleOptional(items, sel, "opt1");
    expect(sel).toEqual(["opt2"]);
    expect(toggleOptional(items, sel, "req1")).toEqual(["opt2"]); // required can't be toggled
    expect(toggleOptional(items, ["ghost", "opt2"], "nope")).toEqual(["opt2"]); // stale ids dropped
  });

  it("base total excludes optional items", () => {
    expect(baseCents(items)).toBe(10010);
  });
});

describe("deposit split", () => {
  it.each([
    [100000, { type: "percent", value: 50 }, 50000, 50000],
    [100001, { type: "percent", value: 50 }, 50001, 50000], // 500.005 rounds half up
    [99999, { type: "percent", value: 30 }, 30000, 69999], // 299.997 -> 300.00
    [10000, { type: "percent", value: 33.33 }, 3333, 6667],
    [10000, { type: "percent", value: "12,5" }, 1250, 8750], // decimal comma
    [10000, { type: "percent", value: 150 }, 10000, 0], // capped at 100%
    [10000, { type: "fixed", value: "2500" }, 10000, 0], // capped at total
    [500000, { type: "fixed", value: "1 500,50" }, 150050, 349950],
    [10000, { type: "fixed", value: 0 }, 0, 10000],
    [10000, null, 0, 10000],
    [10000, { type: "weird", value: 5 }, 0, 10000],
    [0, { type: "percent", value: 50 }, 0, 0],
  ])("%i cents with %j -> %i now + %i later", (total, dep, now, later) => {
    expect(depositSplit(total, dep)).toEqual({ depositCents: now, balanceCents: later });
  });

  it("deposit + balance always equals the total", () => {
    for (const total of [1, 3, 7, 999, 123457, 9999999]) {
      for (const pct of [1, 10, 33.33, 50, 66.67, 99]) {
        const { depositCents, balanceCents } = depositSplit(total, { type: "percent", value: pct });
        expect(depositCents + balanceCents).toBe(total);
        expect(Number.isInteger(depositCents)).toBe(true);
      }
    }
  });

  it("percentOfCents rounds half away from zero", () => {
    expect(percentOfCents(1, 50)).toBe(1); // 0.5c -> 1c
    expect(percentOfCents(3, 50)).toBe(2); // 1.5c -> 2c
    expect(percentOfCents(1000, 0)).toBe(0);
  });

  it("reads the deposit stored on a quote row", () => {
    expect(quoteDeposit({ deposit_type: "percent", deposit_value: "50" })).toEqual({ type: "percent", value: 50 });
    expect(quoteDeposit({ deposit_type: "fixed", deposit_value: 0 })).toBeNull();
    expect(quoteDeposit({ deposit_type: null, deposit_value: 50 })).toBeNull();
    expect(quoteDeposit({})).toBeNull();
  });

  it("validates in plain language", () => {
    expect(validateDeposit(null, 100)).toBeNull();
    expect(validateDeposit({ type: "percent", value: "" }, 100)).toMatch(/above 0/);
    expect(validateDeposit({ type: "percent", value: 120 }, 100)).toMatch(/100%/);
    expect(validateDeposit({ type: "fixed", value: 2 }, 100)).toMatch(/more than the quote total/);
    expect(validateDeposit({ type: "fixed", value: 1 }, 100)).toBeNull();
  });
});

describe("expiry", () => {
  // 2026-11-05 21:30 UTC is already 2026-11-05 23:30 in Johannesburg;
  // 22:30 UTC is 00:30 on the 6th there.
  const before = new Date("2026-11-05T21:30:00Z");
  const after = new Date("2026-11-05T22:30:00Z");

  it("uses the business's calendar day, not UTC", () => {
    expect(todayInZone(before)).toBe("2026-11-05");
    expect(todayInZone(after)).toBe("2026-11-06");
  });

  it("valid_until is inclusive of that whole day", () => {
    const q = { status: "sent", valid_until: "2026-11-05" };
    expect(isExpired(q, before)).toBe(false);
    expect(isExpired(q, after)).toBe(true);
  });

  it("only open quotes expire; accepted/invoiced never do", () => {
    for (const status of ["draft", "sent", "viewed"]) expect(isExpired({ status, valid_until: "2026-01-01" }, after)).toBe(true);
    for (const status of ["accepted", "invoiced", "paid"]) expect(isExpired({ status, valid_until: "2026-01-01" }, after)).toBe(false);
  });

  it("no date means no expiry; timestamps are read as dates", () => {
    expect(isExpired({ status: "sent", valid_until: null }, after)).toBe(false);
    expect(isExpired({ status: "sent", valid_until: "2026-11-04T00:00:00+00:00" }, after)).toBe(true);
    expect(isExpired({ status: "sent", valid_until: "garbage" }, after)).toBe(false);
  });

  it("display status shows expired over sent/viewed", () => {
    expect(displayStatus({ status: "viewed", valid_until: "2026-11-01" }, after)).toBe("expired");
    expect(displayStatus({ status: "viewed", valid_until: "2026-12-01" }, after)).toBe("viewed");
  });

  it("default valid-until counts days from today", () => {
    expect(defaultValidUntil(30, after)).toBe("2026-12-06");
    expect(defaultValidUntil(0, after)).toBe("");
  });

  it("follow-up only while the customer can still accept", () => {
    expect(canFollowUp({ status: "sent" }, after)).toBe(true);
    expect(canFollowUp({ status: "viewed", valid_until: "2026-12-01" }, after)).toBe(true);
    expect(canFollowUp({ status: "viewed", valid_until: "2026-11-01" }, after)).toBe(false);
    for (const status of ["draft", "accepted", "invoiced", "paid"]) expect(canFollowUp({ status }, after)).toBe(false);
  });
});

describe("acceptance snapshot", () => {
  it("freezes the chosen tier with the ticked add-on, deposit split included", () => {
    const q = { ...tiered, deposit_type: "percent", deposit_value: 50 };
    const { snapshot } = buildAcceptanceSnapshot(q, { tierId: "better", optionalIds: ["x"] });
    expect(snapshot.tier_id).toBe("better");
    expect(snapshot.tier_name).toBe("Better");
    expect(snapshot.line_items.map((i) => i.id)).toEqual(["a", "b", "c", "x"]);
    expect(snapshot.optional_ids).toEqual(["x"]);
    expect(snapshot.total).toBe(1350.59);
    expect(snapshot.deposit_amount).toBe(675.3); // 675.295 rounds up
    expect(snapshot.balance_amount).toBe(675.29);
  });

  it("refuses an unknown tier on a tiered quote", () => {
    expect(buildAcceptanceSnapshot(tiered, { tierId: "platinum" })).toEqual({ error: "invalid_tier" });
  });

  it("single-option quotes ignore the tier id and keep the legacy shape", () => {
    const q = { status: "sent", line_items: [li("a", 10), li("o", 5, { optional: true })] };
    const { snapshot } = buildAcceptanceSnapshot(q, { tierId: "whatever" });
    expect(snapshot.tier_id).toBeNull();
    expect(snapshot.line_items.map((i) => i.id)).toEqual(["a"]);
    expect(snapshot.total).toBe(10);
    expect(snapshot.deposit_type).toBeNull();
  });

  it("accepted document uses the snapshot, or the legacy row when there is none", () => {
    const { snapshot } = buildAcceptanceSnapshot({ ...tiered, deposit_type: "fixed", deposit_value: 100 }, { tierId: "good" });
    const doc = acceptedDocument({ status: "invoiced", accepted_selection: snapshot, line_items: [li("old", 1)], total: 1 });
    expect(doc.tierName).toBe("Good");
    expect(doc.totalCents).toBe(125050);
    expect(doc.deposit).toEqual({ depositCents: 10000, balanceCents: 115050 });
    const legacy = acceptedDocument({ status: "accepted", line_items: [li("old", 1)], subtotal: 1, total: 1 });
    expect(legacy.line_items.map((i) => i.id)).toEqual(["old"]);
    expect(legacy.deposit).toBeNull();
  });

  it("typed-name acceptance needs a name and the consent tick", () => {
    expect(validateAcceptance({ fullName: " ", consent: true })).toEqual({ fullName: "Type your full name to accept" });
    expect(validateAcceptance({ fullName: "Test Customer", consent: false })).toEqual({ consent: "Tick the box to confirm you accept" });
    expect(validateAcceptance({ fullName: "Test Customer", consent: true })).toEqual({});
    expect(validateAcceptance({ fullName: "x".repeat(121), consent: true }).fullName).toMatch(/120/);
  });
});

describe("status timeline", () => {
  const now = new Date("2026-11-05T10:00:00Z");
  it("draft: only created is reached", () => {
    expect(buildTimeline({ status: "draft", created_at: "c" }, now).map((s) => s.state)).toEqual(["current", "todo", "todo", "todo"]);
  });

  it("viewed: created, sent done, viewed current, accepted to do", () => {
    const t = buildTimeline({ status: "viewed", created_at: "c", sent_at: "s", viewed_at: "v" }, now);
    expect(t.map((s) => [s.key, s.state, s.at])).toEqual([
      ["created", "done", "c"], ["sent", "done", "s"], ["viewed", "current", "v"], ["accepted", "todo", null],
    ]);
  });

  it("sent before sent_at existed: reached without a time", () => {
    const t = buildTimeline({ status: "sent", created_at: "c" }, now);
    expect(t[1]).toEqual({ key: "sent", label: "Sent", at: null, state: "current" });
  });

  it("expired replaces accepted", () => {
    const t = buildTimeline({ status: "sent", created_at: "c", sent_at: "s", valid_until: "2026-11-01" }, now);
    expect(t.map((s) => s.key)).toEqual(["created", "sent", "viewed", "expired"]);
    expect(t[3].state).toBe("bad");
    expect(t[2].state).toBe("todo");
  });

  it("invoiced adds the invoiced step", () => {
    const t = buildTimeline({ status: "invoiced", created_at: "c", sent_at: "s", viewed_at: "v", accepted_at: "a", invoiced_at: "i" }, now);
    expect(t.map((s) => s.key)).toEqual(["created", "sent", "viewed", "accepted", "invoiced"]);
    expect(t.at(-1).state).toBe("current");
  });
});

describe("builder helpers", () => {
  it("validates a line item with plain-language fixes", () => {
    expect(validateLineItem({ mode: "area", description: "", qty: "", rate: "" })).toEqual({}); // blank row is dropped, not an error
    expect(validateLineItem({ mode: "area", description: "Lawn", qty: "0", rate: "85" })).toEqual({ qty: "Enter area (m²) above 0" });
    expect(validateLineItem({ mode: "unit", description: "Pavers", qty: "2", rate: "0" })).toEqual({ rate: "Enter a rate above 0" });
    expect(validateLineItem({ mode: "plain", description: "", qty: 1, rate: "50" })).toEqual({ description: "Describe the work, e.g. Lay instant lawn" });
    expect(validateLineItem({ mode: "plain", description: "Call-out", qty: 1, rate: "0" })).toEqual({ rate: "Enter an amount above 0" });
  });

  it("steppers move by 1, keep decimals and stop at 0", () => {
    expect(stepQty("2.5", 1)).toBe("3.5");
    expect(stepQty("", 1)).toBe("1");
    expect(stepQty("0.4", -1)).toBe("0");
    expect(stepQty("3", -1)).toBe("2");
  });

  it("inserts a library item into the right calculator mode", () => {
    const it = lineItemFromLibrary({ name: "Compost", description: "Per load", mode: "load", default_rate: 1250 });
    expect(it).toMatchObject({ description: "Compost", detail: "Per load", mode: "load", rate: "1250", qty: "" });
    const plain = lineItemFromLibrary({ name: "Call-out", mode: "plain", default_rate: 350 });
    expect(plain.total).toBe(350);
    expect(lineItemFromLibrary({ name: "x", mode: "nope" }).mode).toBe("unit");
  });

  it("serialises the optional flag and detail only when set", () => {
    const plain = serialiseLineItem({ ...newLineItem("plain"), description: "a", rate: "1" });
    expect(plain).not.toHaveProperty("optional");
    expect(plain).not.toHaveProperty("detail");
    const opt = serialiseLineItem({ ...newLineItem("plain"), description: "a", rate: "1", optional: true, detail: " Extra " });
    expect(opt).toMatchObject({ optional: true, detail: "Extra" });
  });
});
