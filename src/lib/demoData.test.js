import { describe, expect, it, vi } from "vitest";
import { buildDemoLibrary, buildDemoQuotes, DEMO_FLAG, isDemoRow, loadDemoData, removeDemoData, STARTER_LIBRARY } from "./demoData.js";
import { displayStatus, isTiered, quoteDeposit, baseCents } from "./quoteMath.js";
import { toCents } from "./money.js";
import { buildFollowUpMessage, buildFollowUpUrl } from "./shareLinks.js";
import { companyConfig } from "../../companyConfig.js";

const NOW = new Date("2026-11-05T10:00:00Z");
const OWNER = "11111111-1111-4111-8111-111111111111";

// Records every query-builder call so tests can assert the exact filters.
function stubClient({ existing = [], fail = null } = {}) {
  const log = [];
  const builder = (table) => {
    const q = { table, ops: [] };
    log.push(q);
    const chain = {
      select: (c) => { q.ops.push(["select", c]); return chain; },
      insert: (rows) => { q.ops.push(["insert", rows]); return chain; },
      delete: () => { q.ops.push(["delete"]); return chain; },
      eq: (k, v) => { q.ops.push(["eq", k, v]); return chain; },
      limit: (n) => { q.ops.push(["limit", n]); return chain; },
      then: (resolve) => {
        if (fail && q.table === fail) return resolve({ data: null, error: { message: "nope" } });
        const kind = q.ops[0][0];
        if (kind === "insert") return resolve({ data: q.ops[0][1].map((_, i) => ({ id: `id${i}` })), error: null });
        if (kind === "delete") return resolve({ data: [{ id: "d1" }, { id: "d2" }], error: null });
        return resolve({ data: existing, error: null });
      },
    };
    return chain;
  };
  return { log, from: vi.fn(builder) };
}

describe("demo seed contents", () => {
  const quotes = buildDemoQuotes(NOW);

  it("covers every status the brief asks for", () => {
    const shown = quotes.map((q) => displayStatus(q, NOW));
    for (const s of ["draft", "sent", "viewed", "accepted", "expired"]) expect(shown).toContain(s);
    expect(quotes.length).toBeGreaterThanOrEqual(6);
  });

  it("includes a tiered quote, a deposit quote and an optional-items quote", () => {
    expect(quotes.some(isTiered)).toBe(true);
    expect(quotes.some((q) => quoteDeposit(q))).toBe(true);
    expect(quotes.some((q) => q.line_items.some((it) => it.optional))).toBe(true);
  });

  it("marks every row unambiguously as demo", () => {
    for (const q of quotes) {
      expect(isDemoRow(q)).toBe(true);
      if (q.customer_phone) expect(q.customer_phone).toMatch(/^\+2700000000\d$/);
      if (q.customer_email) expect(q.customer_email).toMatch(/@example\.com$/);
    }
    for (const e of buildDemoLibrary()) expect(isDemoRow(e)).toBe(true);
    expect(isDemoRow({})).toBe(false);
    expect(isDemoRow({ is_demo: "true" })).toBe(false);
  });

  it("never sets owner_id: the column default (auth.uid()) decides", () => {
    for (const q of quotes) expect(q).not.toHaveProperty("owner_id");
    for (const e of buildDemoLibrary()) expect(e).not.toHaveProperty("owner_id");
  });

  it("stored totals match the line items", () => {
    for (const q of quotes) {
      if (q.accepted_selection) expect(q.total).toBe(q.accepted_selection.total);
      else if (!isTiered(q)) expect(toCents(q.total)).toBe(baseCents(q.line_items));
    }
  });

  it("the accepted quote carries a typed name and a frozen snapshot", () => {
    const acc = quotes.find((q) => q.status === "accepted");
    expect(acc.accepted_name).toBeTruthy();
    expect(acc.accepted_consent).toBe(true);
    expect(acc.accepted_selection.deposit_amount + acc.accepted_selection.balance_amount).toBeCloseTo(acc.total, 2);
  });

  it("ships a starter library across every calculator mode", () => {
    const modes = new Set(STARTER_LIBRARY.map((e) => e.mode));
    for (const m of ["plain", "area", "unit", "load", "day"]) expect(modes.has(m)).toBe(true);
  });
});

describe("loadDemoData", () => {
  it("inserts quotes and library rows as the signed-in user", async () => {
    const c = stubClient();
    const r = await loadDemoData(c, OWNER, NOW);
    expect(r).toEqual({ skipped: false, quotes: buildDemoQuotes(NOW).length, library: STARTER_LIBRARY.length });
    const [check, ins, lib] = c.log;
    expect(check.ops).toContainEqual(["eq", DEMO_FLAG, true]);
    expect(check.ops).toContainEqual(["eq", "owner_id", OWNER]);
    expect(ins.table).toBe("quotes");
    expect(lib.table).toBe("quote_library_items");
  });

  it("does nothing if this owner already has demo data", async () => {
    const c = stubClient({ existing: [{ id: "x" }] });
    await expect(loadDemoData(c, OWNER, NOW)).resolves.toEqual({ skipped: true, quotes: 0, library: 0 });
    expect(c.log).toHaveLength(1);
  });

  it("needs a signed-in user and surfaces errors", async () => {
    await expect(loadDemoData(stubClient(), null)).rejects.toThrow(/Sign in/);
    await expect(loadDemoData(stubClient({ fail: "quotes" }), OWNER)).rejects.toEqual({ message: "nope" });
  });
});

describe("removeDemoData", () => {
  it("deletes only is_demo rows owned by the caller, in both tables", async () => {
    const c = stubClient();
    await expect(removeDemoData(c, OWNER)).resolves.toEqual({ quotes: 2, library: 2 });
    expect(c.log.map((q) => q.table)).toEqual(["quotes", "quote_library_items"]);
    for (const q of c.log) {
      expect(q.ops[0]).toEqual(["delete"]);
      expect(q.ops).toContainEqual(["eq", DEMO_FLAG, true]);
      expect(q.ops).toContainEqual(["eq", "owner_id", OWNER]);
    }
  });

  it("refuses without an owner (never an unfiltered delete)", async () => {
    const c = stubClient();
    await expect(removeDemoData(c, "")).rejects.toThrow(/Sign in/);
    expect(c.from).not.toHaveBeenCalled();
  });
});

describe("WhatsApp follow-up", () => {
  it("carries the quote number, total and public link", () => {
    const text = buildFollowUpMessage({ customerName: "Test Customer", ref: "Q-3F2A9C", totalText: "R 1 250,00", quoteUrl: "https://quotes.invalid/quote/x" });
    expect(text).toContain("Hi Test Customer,");
    expect(text).toContain("Q-3F2A9C");
    expect(text).toContain("R 1 250,00");
    expect(text).toContain("https://quotes.invalid/quote/x");
    expect(text).toContain(companyConfig.businessName);
  });

  it("builds a wa.me link to the customer's number", () => {
    const url = buildFollowUpUrl({
      quote: { id: "3f2a9c00-0000-4000-8000-000000000000", customer_name: "Test Customer", customer_phone: "+27000000000" },
      ref: "Q-3F2A9C", totalText: "R 10,00", origin: "https://quotes.invalid",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://wa.me/27000000000");
    expect(u.searchParams.get("text")).toContain("https://quotes.invalid/quote/3f2a9c00-0000-4000-8000-000000000000");
  });

  it("is null without a usable number", () => {
    expect(buildFollowUpUrl({ quote: { id: "x", customer_phone: "" }, ref: "Q", totalText: "R", origin: "https://x" })).toBeNull();
  });
});

import { validateLibraryEntry, libraryEntryFromLineItem, toLibraryRow } from "./libraryForm.js";
describe("item library entries", () => {
  it("validates name, mode and rate in plain language", () => {
    expect(validateLibraryEntry({ name: "", mode: "x", rate: "" })).toEqual({
      name: "Name the item, e.g. Instant lawn (Kikuyu)", mode: "Choose how this item is priced", rate: "Enter a default rate above 0",
    });
    expect(validateLibraryEntry({ name: "Compost", mode: "load", rate: "1 250,50" })).toBeNull();
  });
  it("saves a builder line item to the library inline", () => {
    const e = libraryEntryFromLineItem({ description: " Compost ", detail: "Per load", mode: "load", rate: "1250.5" });
    expect(toLibraryRow(e)).toMatchObject({ name: "Compost", description: "Per load", mode: "load", default_rate: 1250.5 });
  });
});
