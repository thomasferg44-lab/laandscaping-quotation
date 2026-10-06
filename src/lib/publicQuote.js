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
