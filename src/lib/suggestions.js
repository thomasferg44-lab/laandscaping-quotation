// Smart line-item suggestions for the builder: remove typing for a phone
// user by surfacing what this business quotes most, one tap to add.
//
// DETERMINISTIC ONLY. Sources are the business's item library and the line
// items of its past quotes (whatever the signed-in user can see under RLS).
// No network calls, no AI: same inputs, same ranking, every time.
//
// Ranking: each distinct item (matched by normalised name) scores
//   uses      = number of past quotes it appears in (counted once per quote)
//   + 0.5     if it is in the item library (the owner saved it on purpose)
// sorted by score, then most recently used, then name. Items already in the
// quote being built are left out. With a query, only items whose name or
// detail contain every typed word are kept, and names that start with the
// query rank first.
//
// Price/mode/detail of a suggestion: the library entry when there is one
// (that is the owner's set price), otherwise the most recent past use.
//
// PASS 2 STUB (pending Tom's decision): generative drafting from voice notes
// or photos would arrive as `extra` candidates ({ name, detail, mode, rate,
// source: "draft" }) from a separate module; this function already merges
// and ranks them like any other source. Nothing in this pass produces them.
import { MODES, computeTotal, newLineItem } from "./lineItems.js";
import { quoteTiers } from "./quoteMath.js";

export const normaliseKey = (s) =>
  String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

const ts = (iso) => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? t : 0; };

function itemsOfQuote(q) {
  const out = [];
  if (Array.isArray(q?.accepted_selection?.line_items)) out.push(...q.accepted_selection.line_items);
  for (const t of quoteTiers(q)) out.push(...(t.line_items ?? []));
  return out;
}

export function buildSuggestions({ library = [], quotes = [], currentItems = [], excludeQuoteId = null, query = "", limit = 6, extra = [] } = {}) {
  const map = new Map();
  const touch = (key, base) => {
    if (!map.has(key)) map.set(key, { key, uses: 0, lastUsed: 0, inLibrary: false, ...base });
    return map.get(key);
  };

  for (const q of quotes) {
    if (!q || q.id === excludeQuoteId) continue;
    const seen = new Set();
    for (const it of itemsOfQuote(q)) {
      const key = normaliseKey(it.description);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const s = touch(key, { name: it.description.trim() });
      s.uses += 1;
      const when = ts(q.created_at);
      if (when >= s.lastUsed) {
        s.lastUsed = when;
        if (!s.inLibrary) Object.assign(s, { name: it.description.trim(), detail: it.detail ?? "", mode: it.mode, rate: it.rate, libraryId: null });
      }
    }
  }
  for (const e of library) {
    const key = normaliseKey(e.name);
    if (!key) continue;
    const s = touch(key, {});
    Object.assign(s, { name: e.name.trim(), detail: e.description ?? "", mode: e.mode, rate: e.default_rate, inLibrary: true, libraryId: e.id ?? null });
  }
  for (const e of extra) {
    const key = normaliseKey(e.name);
    if (!key || map.has(key)) continue;
    touch(key, { name: e.name, detail: e.detail ?? "", mode: e.mode, rate: e.rate, source: e.source ?? "draft" });
  }

  const inQuote = new Set(currentItems.map((it) => normaliseKey(it.description)).filter(Boolean));
  const words = normaliseKey(query).split(" ").filter(Boolean);
  const qKey = words.join(" ");

  return [...map.values()]
    .filter((s) => !inQuote.has(s.key))
    .filter((s) => !words.length || words.every((w) => `${s.key} ${normaliseKey(s.detail)}`.includes(w)))
    .map((s) => ({
      ...s,
      mode: MODES[s.mode] ? s.mode : "unit",
      score: s.uses + (s.inLibrary ? 0.5 : 0),
      source: s.source ?? (s.inLibrary && s.uses ? "both" : s.inLibrary ? "library" : "history"),
      prefix: qKey && s.key.startsWith(qKey) ? 1 : 0,
    }))
    .sort((a, b) => b.prefix - a.prefix || b.score - a.score || b.lastUsed - a.lastUsed || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ prefix, ...s }) => s); // eslint-disable-line no-unused-vars
}

// A builder line item from a suggestion (quantity left for the user, except
// plain items which are complete).
export function lineItemFromSuggestion(s) {
  const item = { ...newLineItem(s.mode), description: s.name, detail: s.detail ?? "", rate: s.rate == null ? "" : String(s.rate) };
  if (s.mode === "plain") item.total = computeTotal(item);
  return item;
}

// Fill an existing (typed-into) line with a suggestion, keeping its id,
// photo and any quantity already entered.
export function applySuggestion(item, s) {
  const next = {
    ...item,
    description: s.name,
    detail: s.detail ?? item.detail ?? "",
    mode: s.mode,
    rate: s.rate == null ? item.rate : String(s.rate),
    qty: s.mode === "plain" ? 1 : item.mode === s.mode ? item.qty : "",
  };
  next.total = computeTotal(next);
  return next;
}
