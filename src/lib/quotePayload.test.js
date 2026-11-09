import { describe, expect, it } from "vitest";
import { addTier, buildQuotePayload, emptyForm, formFromRow, formTotalCents, removeTier } from "./quotePayload.js";
import { computeTotal, newLineItem } from "./lineItems.js";

const NOW = new Date("2026-11-05T10:00:00Z");
const cfg = { depositDefault: { type: "percent", value: 50 }, quoteValidityDays: 30, timeZone: "Africa/Johannesburg" };
const edit = (mode, patch) => { const it = { ...newLineItem(mode), ...patch }; it.total = computeTotal(it); return it; };
const filled = (extra = {}) => ({
  ...emptyForm(cfg, NOW), customer_name: " Test Customer ", customer_phone: "+27000000000",
  line_items: [
    edit("area", { description: "Lawn", qty: "12.5", rate: "85" }),
    edit("unit", { description: "Agapanthus", qty: "20", rate: "75" }),
    edit("load", { description: "Compost", qty: "2", rate: "1250.50", optional: true }),
    newLineItem("area"), // blank row, dropped
  ],
  ...extra,
});

describe("builder payload", () => {
  it("new form gets config defaults: 50% deposit, valid 30 days", () => {
    const f = emptyForm(cfg, NOW);
    expect(f.depositOn).toBe(true);
    expect(f.deposit).toEqual({ type: "percent", value: "50" });
    expect(f.valid_until).toBe("2026-12-05");
    expect(emptyForm({ depositDefault: null, quoteValidityDays: 0 }, NOW)).toMatchObject({ depositOn: false, valid_until: "" });
  });

  it("totals exclude optional items and blank rows", () => {
    const { payload, errors } = buildQuotePayload(filled(), { now: NOW });
    expect(errors).toBeNull();
    expect(payload.line_items).toHaveLength(3);
    expect(payload.total).toBe(2562.5); // 1062.50 + 1500
    expect(payload.customer_name).toBe("Test Customer");
    expect(payload).toMatchObject({ deposit_type: "percent", deposit_value: 50, valid_until: "2026-12-05" });
    expect(formTotalCents(filled())).toBe(256250);
  });

  it("plain quotes omit the new columns so they save on an unpatched database", () => {
    const f = filled({ depositOn: false, valid_until: "" });
    const { payload } = buildQuotePayload(f, { now: NOW });
    for (const k of ["tiers", "deposit_type", "deposit_value", "valid_until"]) expect(payload).not.toHaveProperty(k);
    // ...but clearing them on a row that had them writes null
    const { payload: p2 } = buildQuotePayload(f, { now: NOW, known: { tiers: true, deposit_type: true, deposit_value: true, valid_until: true } });
    expect(p2).toMatchObject({ tiers: null, deposit_type: null, deposit_value: null, valid_until: null });
  });

  it("inline errors with plain-language fixes, data kept", () => {
    const f = filled({ customer_name: "", line_items: [edit("area", { description: "Lawn", qty: "0", rate: "85" })] });
    const { errors, payload } = buildQuotePayload(f, { now: NOW });
    expect(errors.customer_name).toBe("Enter the customer's name");
    expect(Object.values(errors.itemErrors)[0]).toEqual({ qty: "Enter area (m²) above 0" });
    expect(payload.line_items[0].description).toBe("Lawn");
  });

  it("refuses an empty quote, a bad email, a past date and a deposit over 100%", () => {
    const { errors } = buildQuotePayload({ ...filled(), line_items: [newLineItem("area")], customer_email: "nope", valid_until: "2026-11-01", deposit: { type: "percent", value: "150" } }, { now: NOW });
    expect(errors.items).toMatch(/at least one/);
    expect(errors.customer_email).toMatch(/name@example.com/);
    expect(errors.valid_until).toMatch(/passed/);
    expect(errors.deposit).toMatch(/100%/);
  });

  it("an already-past date that wasn't changed doesn't block saving other edits", () => {
    const { errors } = buildQuotePayload(filled({ valid_until: "2026-11-01" }), { now: NOW, known: { valid_until: true, valid_until_original: "2026-11-01" } });
    expect(errors).toBeNull();
  });
});

describe("tiers in the builder", () => {
  it("adding options copies items with fresh ids, up to 3", () => {
    let f = addTier(filled());
    expect(f.tiered).toBe(true);
    expect(f.tiers.map((t) => t.name)).toEqual(["Good", "Better"]);
    const ids = f.tiers.flatMap((t) => t.line_items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    f = addTier(f);
    expect(f.tiers.map((t) => t.name)).toEqual(["Good", "Better", "Best"]);
    expect(addTier(f).tiers).toHaveLength(3);
  });

  it("removing down to one option collapses to a single-option quote", () => {
    const f = addTier(filled());
    const back = removeTier(f, f.tiers[0].id);
    expect(back.tiered).toBe(false);
    expect(back.line_items).toBe(f.tiers[1].line_items);
  });

  it("payload stores tiers, row total is the cheapest option", () => {
    let f = addTier(filled());
    f.tiers[1].line_items = [...f.tiers[1].line_items, edit("day", { description: "Labour", qty: "1", rate: "1800" })];
    const { payload, errors } = buildQuotePayload(f, { now: NOW });
    expect(errors).toBeNull();
    expect(payload.tiers).toHaveLength(2);
    expect(payload.total).toBe(2562.5);
    expect(payload.line_items).toEqual(payload.tiers[0].line_items);
  });

  it("each option needs a distinct name and at least one item", () => {
    const f = addTier(filled());
    f.tiers[1].name = "good";
    f.tiers[0].line_items = [newLineItem("area")];
    const { errors } = buildQuotePayload(f, { now: NOW });
    expect(errors.tierErrors[f.tiers[0].id]).toMatch(/at least one item/);
    expect(errors.tierErrors[f.tiers[1].id]).toMatch(/different name/);
  });

  it("row -> form round trip", () => {
    const { payload } = buildQuotePayload(addTier(filled()), { now: NOW });
    const f = formFromRow({ id: "x", status: "sent", ...payload }, cfg);
    expect(f.tiered).toBe(true);
    expect(f.depositOn).toBe(true);
    expect(f.valid_until).toBe("2026-12-05");
    expect(formFromRow({ id: "y", status: "sent", customer_name: "a", line_items: [] }, cfg).line_items).toHaveLength(1);
  });
});
