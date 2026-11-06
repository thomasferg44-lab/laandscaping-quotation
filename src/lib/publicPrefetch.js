// Start loading the customer's quote the moment the app boots on
// /quote/:token, in parallel with downloading the page's code chunk,
// instead of after it (design spec §2A: LCP under 2.5s on Fast 3G).
import { parseRpcResponse, publicClient } from "./publicClient";
import { fetchPublicQuote, isQuoteToken } from "./publicQuote";

let pending = null;

export function startPublicQuotePrefetch(pathname) {
  const m = /^\/quote\/([^/]+)\/?$/.exec(pathname || "");
  if (!m || !isQuoteToken(m[1])) return;
  const early = typeof window !== "undefined" ? window.__qp : null;
  const promise = early && early.token === m[1].toLowerCase()
    ? early.promise.then(parseRpcResponse).then(({ data, error }) => {
        if (error) throw error;
        return Array.isArray(data) ? data[0] ?? null : data ?? null;
      })
    : fetchPublicQuote(publicClient, m[1]);
  promise.catch(() => {}); // the page handles errors when it takes the result
  pending = { token: m[1], promise };
}

// One-shot: the first load uses the prefetched result; retries fetch fresh.
export function takePrefetchedQuote(token) {
  if (pending?.token !== token) return null;
  const p = pending.promise;
  pending = null;
  return p;
}
