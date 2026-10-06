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
