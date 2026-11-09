import { describe, expect, it, vi } from "vitest";
import { applySuggestion, buildSuggestions, lineItemFromSuggestion, normaliseKey } from "./suggestions.js";
import { paymentBlock, safePaymentLink } from "./payment.js";
import { checkHealth, configPresence, healthSummary, PROBE_TOKEN, probeDatabase } from "./health.js";
import { newLineItem } from "./lineItems.js";

const li = (description, extra = {}) => ({ id: description + Math.random(), description, mode: "area", qty: 1, rate: 85, total: 85, ...extra });
const q = (id, created_at, items, extra = {}) => ({ id, created_at, status: "sent", line_items: items, ...extra });

describe("smart suggestions (deterministic)", () => {
  const quotes = [
    q("q1", "2026-10-01T08:00:00Z", [li("Instant lawn (Kikuyu)", { rate: 80 }), li("Compost delivery", { mode: "load", rate: 1200 })]),
    q("q2", "2026-10-20T08:00:00Z", [li("instant lawn  kikuyu", { rate: 90, detail: "laid" }), li("Rubble removal", { mode: "load", rate: 650 })]),
    q("q3", "2026-11-01T08:00:00Z", [li("Instant Lawn (Kikuyu)", { rate: 95 }), li("Instant lawn (Kikuyu)", { rate: 95 })]), // twice in one quote counts once
    q("q4", "2026-11-02T08:00:00Z", [], { tiers: [{ id: "a", name: "A", line_items: [li("Compost delivery", { mode: "load", rate: 1300 })] }, { id: "b", name: "B", line_items: [li("Paving", { rate: 320 })] }] }),
  ];
  const library = [{ id: "L1", name: "Paving", description: "Cement pavers", mode: "area", default_rate: 330 }, { id: "L2", name: "Call-out fee", mode: "plain", default_rate: 350 }];

  it("ranks most-used first, counting each item once per quote, across tiers", () => {
    const s = buildSuggestions({ quotes });
    expect(s.map((x) => [x.name, x.uses])).toEqual([["Instant Lawn (Kikuyu)", 3], ["Compost delivery", 2], ["Paving", 1], ["Rubble removal", 1]]);
  });

  it("uses the most recent price for history items, and the library price when saved", () => {
    const s = buildSuggestions({ quotes, library });
    const lawn = s.find((x) => x.key === "instant lawn kikuyu");
    expect(lawn.rate).toBe(95);
    const paving = s.find((x) => x.key === "paving");
    expect(paving).toMatchObject({ rate: 330, detail: "Cement pavers", source: "both", inLibrary: true, score: 1.5 });
    expect(s.find((x) => x.key === "call out fee")).toMatchObject({ source: "library", score: 0.5 });
  });

  it("is deterministic: same inputs, same order", () => {
    const a = buildSuggestions({ quotes, library, limit: 10 });
    const b = buildSuggestions({ quotes: [...quotes].reverse(), library: [...library].reverse(), limit: 10 });
    expect(b.map((x) => x.key)).toEqual(a.map((x) => x.key));
  });

  it("leaves out items already on the quote and the quote being edited", () => {
    const s = buildSuggestions({ quotes, currentItems: [{ description: "Instant lawn (kikuyu)" }], excludeQuoteId: "q2" });
    expect(s.some((x) => x.key === "instant lawn kikuyu")).toBe(false);
    expect(s.some((x) => x.key === "rubble removal")).toBe(false); // only on q2
  });

  it("filters by typed words; names that start with the query come first", () => {
    const s = buildSuggestions({ quotes, library, query: "co" });
    expect(s.map((x) => x.name)).toEqual(["Compost delivery"]);
    const s2 = buildSuggestions({ quotes, library, query: "cement" }); // matches the detail line
    expect(s2.map((x) => x.name)).toEqual(["Paving"]);
    expect(buildSuggestions({ quotes, query: "zzz" })).toEqual([]);
  });

  it("caps the list and copes with empty input", () => {
    expect(buildSuggestions({ quotes, library, limit: 2 })).toHaveLength(2);
    expect(buildSuggestions()).toEqual([]);
    expect(normaliseKey("  Instant-lawn,  (Kikuyu) ")).toBe("instant lawn kikuyu");
  });

  it("pass-2 stub: extra candidates merge without overriding real data", () => {
    const s = buildSuggestions({ quotes, extra: [{ name: "Paving", rate: 1 }, { name: "Hedge trim", mode: "day", rate: 900 }], limit: 10 });
    expect(s.find((x) => x.key === "paving").rate).toBe(320);
    expect(s.find((x) => x.key === "hedge trim").source).toBe("draft");
  });

  it("one tap builds or fills a line item", () => {
    const sug = { name: "Compost delivery", detail: "6 m³", mode: "load", rate: 1250 };
    expect(lineItemFromSuggestion(sug)).toMatchObject({ description: "Compost delivery", detail: "6 m³", mode: "load", rate: "1250", qty: "" });
    expect(lineItemFromSuggestion({ name: "Call-out", mode: "plain", rate: 350 }).total).toBe(350);
    const typed = { ...newLineItem("load"), description: "comp", qty: "2" };
    expect(applySuggestion(typed, sug)).toMatchObject({ id: typed.id, description: "Compost delivery", qty: "2", total: 2500 });
  });
});

describe("payment block", () => {
  it("accepts only https payment links", () => {
    expect(safePaymentLink("https://pay.example.com/x")).toBe("https://pay.example.com/x");
    for (const bad of ["", "http://pay.example.com", "javascript:alert(1)", "pay.example.com", null, 5]) expect(safePaymentLink(bad)).toBeNull();
  });
  it("shows bank details and link, titled for the quote's stage; hidden when paid or empty", () => {
    const cfg = { paymentInstructions: " EFT to Test ", paymentLink: "https://pay.example.com" };
    expect(paymentBlock(cfg, { status: "viewed" }, "Q-1")).toEqual({ title: "Payment details", note: "Pay once you've accepted this quote.", instructions: "EFT to Test", link: "https://pay.example.com/", reference: "Q-1" });
    expect(paymentBlock(cfg, { status: "invoiced" }, "INV-1")).toMatchObject({ title: "How to pay", note: null });
    expect(paymentBlock(cfg, { status: "paid" }, "INV-1")).toBeNull();
    expect(paymentBlock({ paymentInstructions: "", paymentLink: "http://x" }, { status: "invoiced" })).toBeNull();
    expect(paymentBlock({ paymentLink: "https://pay.example.com" }, { status: "accepted" }, "Q")).toMatchObject({ instructions: null, link: "https://pay.example.com/" });
  });
});

describe("health check", () => {
  const env = { supabaseUrl: "https://abc.supabase.co", supabaseAnonKey: "anon-secret-key" };
  const cfg = { businessName: "Test Co", logoUrl: "/l.svg", whatsappNumber: "27000000099", contactEmail: "a@test.co.za", paymentInstructions: "EFT", paymentLink: "" };

  it("probes the database with a read-only all-zero token", async () => {
    const f = vi.fn(async () => ({ ok: true }));
    await expect(probeDatabase({ ...env, fetchImpl: f, now: (() => { let t = 0; return () => (t += 40); })() })).resolves.toEqual({ reachable: true, latencyMs: 40 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://abc.supabase.co/rest/v1/rpc/get_public_quote");
    expect(JSON.parse(init.body)).toEqual({ p_token: PROBE_TOKEN });
  });

  it("reports unreachable on errors, non-2xx or missing env", async () => {
    expect((await probeDatabase({ ...env, fetchImpl: async () => { throw new Error("x"); } })).reachable).toBe(false);
    expect((await probeDatabase({ ...env, fetchImpl: async () => ({ ok: false }) })).reachable).toBe(false);
    const f = vi.fn();
    expect((await probeDatabase({ supabaseUrl: "", supabaseAnonKey: "", fetchImpl: f })).reachable).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns ok + booleans only: no secret or config values leak", async () => {
    const h = await checkHealth({ config: cfg, env, fetchImpl: async () => ({ ok: true }) });
    expect(h).toMatchObject({ ok: true, healthy: true, database: true, configComplete: true });
    expect(Object.values(h.config).every((v) => typeof v === "boolean")).toBe(true);
    const raw = JSON.stringify(h);
    for (const secret of ["anon-secret-key", "abc.supabase.co", "27000000099", "a@test.co.za", "Test Co", "EFT"]) expect(raw).not.toContain(secret);
  });

  it("flags placeholders as missing (invalid number, .invalid email)", () => {
    const p = configPresence({ businessName: "X", whatsappNumber: "27XXXXXXXXX", contactEmail: "q@placeholder.invalid", paymentLink: "http://no" }, {});
    expect(p).toMatchObject({ whatsappNumber: false, contactEmail: false, paymentLink: false, supabaseUrl: false, supabaseAnonKey: false });
  });

  it("summarises for the status line", () => {
    expect(healthSummary(null).tone).toBe("unknown");
    expect(healthSummary({ error: "unavailable" }).text).toBe("Status check unavailable");
    expect(healthSummary({ database: false }).text).toBe("Database not reachable");
    expect(healthSummary({ database: true, configComplete: false }).tone).toBe("bad");
    expect(healthSummary({ database: true, configComplete: true, config: { paymentInstructions: false, paymentLink: false, whatsappNumber: true } }).text).toBe("Connected · add payment details");
    expect(healthSummary({ database: true, configComplete: true, config: { paymentInstructions: true, whatsappNumber: true } })).toEqual({ tone: "good", text: "All systems normal" });
  });
});

describe("GET /api/health (Netlify Function)", () => {
  it("answers JSON, no-store, booleans only, using the configured env", async () => {
    const realFetch = globalThis.fetch;
    const old = { ...process.env };
    process.env.VITE_SUPABASE_URL = "https://abc.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-secret-key";
    globalThis.fetch = vi.fn(async () => ({ ok: true }));
    try {
      const { default: handler } = await import("../../netlify/functions/health.mjs");
      const res = await handler(new Request("https://x/api/health"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, database: true, configComplete: true });
      expect(body.config.whatsappNumber).toBe(false); // base config's placeholder number
      expect(JSON.stringify(body)).not.toMatch(/anon-secret-key|abc\.supabase\.co/);
    } finally {
      globalThis.fetch = realFetch;
      process.env = old;
    }
  });
});
