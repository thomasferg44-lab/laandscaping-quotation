import { describe, expect, it, vi } from "vitest";
import { createPublicRpcClient, hasOwnerSession } from "./publicClient.js";

const res = (status, body) => ({ ok: status < 300, status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });

describe("public RPC client (fetch, no supabase-js)", () => {
  it("POSTs args to /rest/v1/rpc/<fn> with the anon key", async () => {
    const f = vi.fn(async () => res(200, [{ id: "x" }]));
    const c = createPublicRpcClient("https://abc.supabase.co/", "anon-key", f);
    await expect(c.rpc("get_public_quote", { p_token: "t" })).resolves.toEqual({ data: [{ id: "x" }], error: null });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://abc.supabase.co/rest/v1/rpc/get_public_quote");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("anon-key");
    expect(init.headers.Authorization).toBe("Bearer anon-key");
    expect(JSON.parse(init.body)).toEqual({ p_token: "t" });
  });
  it("void functions (204, empty body) resolve with data null", async () => {
    const c = createPublicRpcClient("https://abc.supabase.co", "k", async () => res(204));
    await expect(c.rpc("mark_public_quote_viewed", {})).resolves.toEqual({ data: null, error: null });
  });
  it("server errors come back as { error } like supabase-js", async () => {
    const c = createPublicRpcClient("https://abc.supabase.co", "k", async () => res(404, { code: "PGRST202", message: "Could not find the function" }));
    await expect(c.rpc("accept_public_quote_v2", {})).resolves.toEqual({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  });
  it("network failures throw (so the page can show offline/error)", async () => {
    const c = createPublicRpcClient("https://abc.supabase.co", "k", async () => { throw new TypeError("Failed to fetch"); });
    await expect(c.rpc("get_public_quote", {})).rejects.toThrow("Failed to fetch");
  });
  it("detects the landscaper's stored session without supabase-js", () => {
    const store = (o) => ({ getItem: (k) => o[k] ?? null });
    expect(hasOwnerSession(store({ "sb-abc-auth-token": "{}" }), "https://abc.supabase.co")).toBe(true);
    expect(hasOwnerSession(store({ "sb-public-quote": "{}" }), "https://abc.supabase.co")).toBe(false);
    expect(hasOwnerSession(store({}), "not a url")).toBe(false);
  });
});

import { parseRpcResponse } from "./publicClient.js";
describe("early inline fetch handoff", () => {
  it("parses the inline script's raw response the same way", () => {
    expect(parseRpcResponse({ ok: true, status: 200, text: '[{"id":"x"}]' })).toEqual({ data: [{ id: "x" }], error: null });
    expect(parseRpcResponse({ ok: false, status: 500, text: "oops" })).toEqual({ data: null, error: { message: "HTTP 500", status: 500 } });
  });
});
