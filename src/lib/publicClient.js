// The customer page's database client: a few lines of fetch against
// PostgREST's RPC endpoint, instead of supabase-js (~50 KB gzipped) on the
// page that opens on cheap phones over mobile data. Same contract as
// supabase-js .rpc(): resolves { data, error }; network failures throw.
// Always anon (no session), exactly like the customer's phone.
import { createMockClient } from "../dev/mockBackend.js";

const MOCK = import.meta.env.VITE_MOCK_BACKEND === "1";
const URL_ = import.meta.env.VITE_SUPABASE_URL ?? "";
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export function createPublicRpcClient(baseUrl, anonKey, fetchImpl = (...a) => fetch(...a)) {
  return {
    async rpc(fn, args = {}) {
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(args),
      });
      return parseRpcResponse({ ok: res.ok, status: res.status, text: await res.text() });
    },
  };
}

export function parseRpcResponse({ ok, status, text }) {
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!ok) return { data: null, error: body && typeof body === "object" ? body : { message: `HTTP ${status}`, status } };
  return { data: body, error: null };
}

export const publicClient = MOCK ? createMockClient({ anonOnly: true }) : createPublicRpcClient(URL_, KEY);

// Is the landscaper signed in on this device? (Their preview of a quote
// shouldn't count as the customer viewing it.) Reads supabase-js's stored
// session key without loading supabase-js.
export function hasOwnerSession(storage = globalThis.localStorage, baseUrl = URL_) {
  try {
    if (MOCK) return Boolean(storage.getItem("dropstack-mock-session-v1"));
    const ref = new URL(baseUrl).hostname.split(".")[0];
    return Boolean(storage.getItem(`sb-${ref}-auth-token`));
  } catch {
    return false;
  }
}
