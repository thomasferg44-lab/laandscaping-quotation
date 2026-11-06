import { describe, expect, it, vi } from "vitest";
import { acceptPublicQuote, fetchPublicQuote, isQuoteToken, markPublicQuoteViewed } from "./publicQuote.js";

const TOKEN = "3f2a9c00-0000-4000-8000-000000000000";
const QUOTE = { id: TOKEN, status: "sent", customer_name: "Test Customer" };

// Minimal stand-in for supabase-js: records rpc calls, returns canned results.
function stubClient(results = {}) {
  const calls = [];
  return {
    calls,
    rpc: vi.fn(async (fn, args) => {
      calls.push([fn, args]);
      const r = results[fn];
      return typeof r === "function" ? r(args) : r ?? { data: null, error: null };
    }),
  };
}

describe("isQuoteToken", () => {
  it.each([
    [TOKEN, true],
    [TOKEN.toUpperCase(), true],
    ["", false],
    [null, false],
    [undefined, false],
    ["%", false],
    ["*", false],
    ["3f2a9c00", false],
    [`${TOKEN} `, false],
    [`${TOKEN}' or 1=1 --`, false],
    ["3f2a9c00-0000-4000-8000-00000000000g", false],
  ])("%j -> %s", (token, ok) => {
    expect(isQuoteToken(token)).toBe(ok);
  });
});

describe("fetchPublicQuote", () => {
  it("calls get_public_quote with the token and returns the single row", async () => {
    const client = stubClient({ get_public_quote: { data: [QUOTE], error: null } });
    await expect(fetchPublicQuote(client, TOKEN)).resolves.toEqual(QUOTE);
    expect(client.calls).toEqual([["get_public_quote", { p_token: TOKEN }]]);
  });

  it("returns null for an empty result (wrong token, or a draft)", async () => {
    const client = stubClient({ get_public_quote: { data: [], error: null } });
    await expect(fetchPublicQuote(client, TOKEN)).resolves.toBeNull();
  });

  it("never sends a malformed token to the server", async () => {
    const client = stubClient();
    for (const bad of ["", "%", "*", "abc", null]) {
      await expect(fetchPublicQuote(client, bad)).resolves.toBeNull();
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("never touches the quotes table directly", async () => {
    const client = { ...stubClient({ get_public_quote: { data: [QUOTE], error: null } }), from: vi.fn() };
    await fetchPublicQuote(client, TOKEN);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("throws on a server error so the page can tell it apart from not-found", async () => {
    const client = stubClient({ get_public_quote: { data: null, error: { message: "boom" } } });
    await expect(fetchPublicQuote(client, TOKEN)).rejects.toEqual({ message: "boom" });
  });
});

describe("markPublicQuoteViewed", () => {
  it("calls mark_public_quote_viewed", async () => {
    const client = stubClient();
    await markPublicQuoteViewed(client, TOKEN);
    expect(client.calls).toEqual([["mark_public_quote_viewed", { p_token: TOKEN }]]);
  });

  it("skips malformed tokens", async () => {
    const client = stubClient();
    await markPublicQuoteViewed(client, "nope");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("acceptPublicQuote", () => {
  it("accepts and returns the fresh quote", async () => {
    const client = stubClient({
      accept_public_quote: { data: true, error: null },
      get_public_quote: { data: [{ ...QUOTE, status: "accepted" }], error: null },
    });
    await expect(acceptPublicQuote(client, TOKEN)).resolves.toEqual({
      accepted: true,
      quote: { ...QUOTE, status: "accepted" },
    });
    expect(client.calls.map(([fn]) => fn)).toEqual(["accept_public_quote", "get_public_quote"]);
  });

  it("reports not accepted but still returns the current state", async () => {
    const client = stubClient({
      accept_public_quote: { data: false, error: null },
      get_public_quote: { data: [{ ...QUOTE, status: "invoiced" }], error: null },
    });
    const r = await acceptPublicQuote(client, TOKEN);
    expect(r.accepted).toBe(false);
    expect(r.quote.status).toBe("invoiced");
  });

  it("throws on a server error", async () => {
    const client = stubClient({ accept_public_quote: { data: null, error: { message: "denied" } } });
    await expect(acceptPublicQuote(client, TOKEN)).rejects.toEqual({ message: "denied" });
  });
});

import { acceptPublicQuoteV2 } from "./publicQuote.js";
describe("acceptPublicQuoteV2", () => {
  it("sends the typed name, consent, tier and add-ons; returns the server's word + fresh quote", async () => {
    const client = stubClient({
      accept_public_quote_v2: { data: "accepted", error: null },
      get_public_quote: { data: [{ ...QUOTE, status: "accepted" }], error: null },
    });
    const r = await acceptPublicQuoteV2(client, TOKEN, { fullName: "Test Customer", consent: true, tierId: "best", optionalIds: ["x"] });
    expect(r).toEqual({ result: "accepted", quote: { ...QUOTE, status: "accepted" }, legacy: false });
    expect(client.calls[0]).toEqual(["accept_public_quote_v2", { p_token: TOKEN, p_full_name: "Test Customer", p_consent: true, p_tier_id: "best", p_optional_ids: ["x"] }]);
  });

  it("passes refusals through (expired is enforced server-side)", async () => {
    const client = stubClient({ accept_public_quote_v2: { data: "expired", error: null }, get_public_quote: { data: [QUOTE], error: null } });
    expect((await acceptPublicQuoteV2(client, TOKEN, { fullName: "A B", consent: true })).result).toBe("expired");
  });

  it("falls back to the old accept for a single-option quote when the patch isn't applied", async () => {
    const client = stubClient({
      accept_public_quote_v2: { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      accept_public_quote: { data: true, error: null },
      get_public_quote: { data: [{ ...QUOTE, status: "accepted" }], error: null },
    });
    const r = await acceptPublicQuoteV2(client, TOKEN, { fullName: "A B", consent: true }, { legacyFallback: true });
    expect(r.result).toBe("accepted");
    expect(r.legacy).toBe(true);
  });

  it("never falls back for a tiered quote, or on other errors", async () => {
    const missing = stubClient({ accept_public_quote_v2: { data: null, error: { code: "PGRST202" } } });
    await expect(acceptPublicQuoteV2(missing, TOKEN, { fullName: "A B", consent: true })).rejects.toEqual({ code: "PGRST202" });
    const boom = stubClient({ accept_public_quote_v2: { data: null, error: { message: "boom" } } });
    await expect(acceptPublicQuoteV2(boom, TOKEN, { fullName: "A B", consent: true }, { legacyFallback: true })).rejects.toEqual({ message: "boom" });
  });

  it("skips malformed tokens", async () => {
    const client = stubClient();
    expect((await acceptPublicQuoteV2(client, "nope", { fullName: "A B", consent: true })).result).toBe("not_found");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
