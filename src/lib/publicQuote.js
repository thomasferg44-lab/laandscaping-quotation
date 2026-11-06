// Data access for the hosted /quote/:token page. anon has no table access
// (supabase/patches/2026-10-06-lock-down-access.sql); everything goes
// through three SECURITY DEFINER functions keyed by the quote's token.
// The token is the quote id: a random v4 uuid from gen_random_uuid().
//
// `client` is passed in (supabasePublic in the app, a stub in tests) so this
// module has no Supabase import and stays pure.

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isQuoteToken(token) {
  return typeof token === "string" && TOKEN_RE.test(token);
}

// One quote or null. null covers unknown tokens, drafts and malformed links
// alike: the page shows the same "not available" message for all of them.
// Throws only on a real error (network, server).
export async function fetchPublicQuote(client, token) {
  if (!isQuoteToken(token)) return null;
  const { data, error } = await client.rpc("get_public_quote", { p_token: token });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

// sent -> viewed. Silent no-op server-side for any other status.
export async function markPublicQuoteViewed(client, token) {
  if (!isQuoteToken(token)) return;
  const { error } = await client.rpc("mark_public_quote_viewed", { p_token: token });
  if (error) throw error;
}

// sent|viewed -> accepted. Returns the fresh quote either way, so the page
// shows the truth if someone else got there first.
export async function acceptPublicQuote(client, token) {
  if (!isQuoteToken(token)) return { accepted: false, quote: null };
  const { data, error } = await client.rpc("accept_public_quote", { p_token: token });
  if (error) throw error;
  return { accepted: data === true, quote: await fetchPublicQuote(client, token) };
}

const isMissingFunction = (e) => e?.code === "PGRST202" || /could not find the function/i.test(String(e?.message ?? ""));

// Typed-name acceptance (2026-11-05 patch): full name, consent tick, chosen
// tier and ticked optional ids. The server recomputes every total.
// Returns { result, quote, legacy } where result is the server's word:
// 'accepted' | 'not_open' | 'expired' | 'invalid_tier' | 'name_required'
// | 'consent_required' | 'not_found'.
//
// legacyFallback: if the patch isn't applied yet (function missing), a
// single-option quote is accepted through the old accept_public_quote so
// customers are never stuck; the typed name is then NOT stored (legacy=true).
// Never used for tiered quotes: the old function can't record a tier.
export async function acceptPublicQuoteV2(client, token, { fullName, consent, tierId = null, optionalIds = [] }, { legacyFallback = false } = {}) {
  if (!isQuoteToken(token)) return { result: "not_found", quote: null, legacy: false };
  const { data, error } = await client.rpc("accept_public_quote_v2", {
    p_token: token, p_full_name: fullName, p_consent: consent === true, p_tier_id: tierId, p_optional_ids: optionalIds,
  });
  if (error) {
    if (!(legacyFallback && isMissingFunction(error))) throw error;
    const { accepted, quote } = await acceptPublicQuote(client, token);
    return { result: accepted ? "accepted" : "not_open", quote, legacy: true };
  }
  return { result: data ?? "not_found", quote: await fetchPublicQuote(client, token), legacy: false };
}
