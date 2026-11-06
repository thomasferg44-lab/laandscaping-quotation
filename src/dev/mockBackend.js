// LOCAL TEST BACKEND. Never used in a real deploy.
//
// An in-memory stand-in for the slice of supabase-js this app uses, so every
// flow can be driven in a browser (Gate 2/4/5 runs, screenshots, demos on a
// laptop) without a network and without touching any real database. Active
// only when the build sets VITE_MOCK_BACKEND=1 (see src/lib/supabaseClient.js);
// otherwise this module is tree-shaken out of the bundle.
//
// It mirrors the real access model closely enough to exercise the UI:
//   * anon (the public client) gets no table access, only the RPCs
//   * authenticated rows are scoped to owner_id unless the user is on the
//     business allowlist; inserts default owner_id to the signed-in user
//   * the status-timestamp trigger and the accept rules come from the same
//     pure functions the app uses (quoteMath.js)
// The real SQL is verified separately (supabase/verify-*.sql); a pass here
// proves the UI and the pure logic, not the database.
//
// Persisted in localStorage so a second tab (the "customer") sees the same
// data, and change events reach the dashboard via BroadcastChannel, which
// stands in for Supabase Realtime.
//
// Test switches (localStorage):
//   dropstack-mock-latency  ms per call (default 120)
//   dropstack-mock-fail     "rpc" -> public calls fail; "all" -> every call fails
//   dropstack-mock-schema   "legacy" -> behave like the database BEFORE the
//                           2026-11-05 patch (no new columns, no library
//                           table, no accept_public_quote_v2)
import { buildAcceptanceSnapshot, isExpired, isTiered, validateAcceptance } from "../lib/quoteMath.js";

const DB_KEY = "dropstack-mock-db-v1";
const SESSION_KEY = "dropstack-mock-session-v1";
export const MOCK_OWNER_ID = "00000000-0000-4000-8000-00000000a11c";
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PUBLIC_COLUMNS = [
  "id", "status", "customer_name", "customer_phone", "customer_email", "line_items", "subtotal", "total",
  "created_at", "viewed_at", "accepted_at", "invoiced_at", "paid_at",
  "tiers", "deposit_type", "deposit_value", "valid_until", "sent_at",
  "accepted_name", "accepted_tier_id", "accepted_selection", "is_demo",
];

const LEGACY_QUOTE_COLUMNS = [
  "id", "owner_id", "customer_name", "customer_phone", "customer_email", "line_items", "subtotal", "total",
  "status", "parent_quote_id", "portion", "viewed_at", "accepted_at", "invoiced_at", "paid_at", "created_at", "updated_at",
];
const legacy = () => ls.get("dropstack-mock-schema") === "legacy";
const legacyOnly = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => LEGACY_QUOTE_COLUMNS.includes(k)));
function unknownLegacyColumn(table, obj) {
  if (!legacy() || table !== "quotes") return null;
  const bad = Object.keys(obj ?? {}).find((k) => !LEGACY_QUOTE_COLUMNS.includes(k));
  return bad ? { code: "PGRST204", message: `Could not find the '${bad}' column of 'quotes' in the schema cache` } : null;
}

const QUOTE_DEFAULTS = () => ({
  owner_id: null, customer_name: "", customer_phone: null, customer_email: null,
  line_items: [], subtotal: 0, total: 0, status: "draft", parent_quote_id: null, portion: null,
  sent_at: null, viewed_at: null, accepted_at: null, invoiced_at: null, paid_at: null,
  tiers: null, deposit_type: null, deposit_value: null, valid_until: null,
  accepted_name: null, accepted_consent: null, accepted_tier_id: null, accepted_selection: null,
  is_demo: false,
});
const LIBRARY_DEFAULTS = () => ({ owner_id: null, name: "", description: null, mode: "unit", default_rate: 0, is_demo: false });
const DEFAULTS = { quotes: QUOTE_DEFAULTS, quote_library_items: LIBRARY_DEFAULTS };

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* full or blocked: memory only */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let memory = null;
function db() {
  const raw = ls.get(DB_KEY);
  if (raw) { try { memory = JSON.parse(raw); } catch { /* keep memory */ } }
  if (!memory) memory = { quotes: [], quote_library_items: [], business_users: [MOCK_OWNER_ID], files: {} };
  for (const t of ["quotes", "quote_library_items"]) memory[t] ??= [];
  memory.business_users ??= [MOCK_OWNER_ID];
  memory.files ??= {};
  return memory;
}
function save(state) { memory = state; ls.set(DB_KEY, JSON.stringify(state)); }

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

async function delay(kind) {
  const fail = ls.get("dropstack-mock-fail");
  const ms = Number(ls.get("dropstack-mock-latency") ?? 120);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  if (fail === "all" || (fail === "rpc" && kind === "rpc")) {
    throw Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" });
  }
}

// --- realtime stand-in -------------------------------------------------------
const listeners = new Set();
let bc = null;
function channelBus() {
  if (bc || typeof BroadcastChannel === "undefined") return bc;
  bc = new BroadcastChannel("dropstack-mock");
  bc.onmessage = (e) => { memory = null; for (const l of listeners) l(e.data); };
  return bc;
}
function emit(table, eventType, row, old) {
  const payload = { table, eventType, new: clone(row) ?? {}, old: clone(old) ?? {} };
  for (const l of listeners) l(payload);
  channelBus()?.postMessage(payload);
}

// --- the status trigger -------------------------------------------------------
function stamp(oldRow, next) {
  if (next.status !== oldRow.status) {
    for (const s of legacy() ? ["viewed", "accepted", "invoiced", "paid"] : ["sent", "viewed", "accepted", "invoiced", "paid"]) {
      if (next.status === s && !next[`${s}_at`]) next[`${s}_at`] = nowIso();
    }
  }
  next.updated_at = nowIso();
  return next;
}

// --- query builder ------------------------------------------------------------
class Query {
  constructor(client, table) {
    Object.assign(this, { client, table, op: "select", cols: "*", filters: [], orderBy: null, lim: null, singleMode: null, returning: false });
  }
  select(cols = "*") { if (this.op === "select") this.cols = cols; else { this.returning = true; this.cols = cols; } return this; }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  in(k, arr) { this.filters.push((r) => arr.includes(r[k])); return this; }
  order(k, { ascending = true } = {}) { this.orderBy = { k, ascending }; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.singleMode = "one"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }

  project(row) {
    if (this.cols === "*" || !this.cols) return clone(row);
    const out = {};
    for (const c of this.cols.split(",").map((s) => s.trim())) out[c] = clone(row[c]);
    return out;
  }

  async run() {
    try { await delay("table"); } catch (e) { return { data: null, error: { message: e.message } }; }
    const uid = this.client.session()?.user?.id ?? null;
    if (!uid) return { data: null, error: { code: "42501", message: `permission denied for table ${this.table}` } };
    if (legacy() && this.table === "quote_library_items") {
      return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.quote_library_items' in the schema cache" } };
    }
    for (const p of [].concat(this.payload ?? [])) { const bad = unknownLegacyColumn(this.table, p); if (bad) return { data: null, error: bad }; }
    if (!DEFAULTS[this.table]) return { data: null, error: { code: "42P01", message: `relation "${this.table}" does not exist` } };
    const state = db();
    const biz = state.business_users.includes(uid);
    const visible = (r) => biz || r.owner_id === uid;
    const rows = state[this.table];
    let result = [];

    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const p of list) {
        const defaults = legacy() && this.table === "quotes" ? legacyOnly(DEFAULTS.quotes()) : DEFAULTS[this.table]();
        const row = { ...defaults, id: uuid(), created_at: nowIso(), ...clone(p), updated_at: nowIso() };
        row.owner_id = p.owner_id ?? uid;
        if (!biz && row.owner_id !== uid) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
        result.push(row);
      }
      rows.push(...result);
      save(state);
      for (const r of result) emit(this.table, "INSERT", r);
    } else {
      const matched = rows.filter((r) => visible(r) && this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of matched) {
          const old = clone(r);
          Object.assign(r, stamp(old, { ...r, ...clone(this.payload) }));
          result.push(r);
          emit(this.table, "UPDATE", r, old);
        }
        save(state);
      } else if (this.op === "delete") {
        state[this.table] = rows.filter((r) => !matched.includes(r));
        save(state);
        result = matched;
        for (const r of matched) emit(this.table, "DELETE", null, { id: r.id });
      } else {
        result = matched;
      }
    }

    if (this.orderBy) {
      const { k, ascending } = this.orderBy;
      result = [...result].sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (ascending ? 1 : -1));
    }
    if (this.lim != null) result = result.slice(0, this.lim);
    const data = result.map((r) => this.project(r));
    if (this.singleMode === "one") {
      if (data.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      return { data: data[0], error: null };
    }
    if (this.singleMode === "maybe") {
      if (data.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }
}
// --- public RPCs (mirror supabase/patches/2026-11-05-compete-upgrades.sql) ----
function publicRow(q) {
  if (legacy()) return Object.fromEntries(PUBLIC_COLUMNS.filter((c) => LEGACY_QUOTE_COLUMNS.includes(c)).map((c) => [c, clone(q[c] ?? null)]));
  const out = {};
  for (const c of PUBLIC_COLUMNS) out[c] = clone(q[c] ?? null);
  out.is_expired = isExpired(q);
  return out;
}

function acceptAsCustomer(state, token, { fullName = null, consent = null, tierId = null, optionalIds = [], requireSignature }) {
  if (!TOKEN_RE.test(String(token ?? ""))) return "not_found";
  if (requireSignature) {
    const errs = validateAcceptance({ fullName, consent });
    if (errs.fullName) return "name_required";
    if (errs.consent) return "consent_required";
  }
  const q = state.quotes.find((r) => r.id === token && r.status !== "draft");
  if (!q) return "not_found";
  if (q.status !== "sent" && q.status !== "viewed") return "not_open";
  if (isExpired(q)) return "expired";
  if (legacy()) {
    const old = clone(q);
    Object.assign(q, stamp(old, { ...q, status: "accepted" }));
    save(state); emit("quotes", "UPDATE", q, old);
    return "accepted";
  }
  const { snapshot, error } = buildAcceptanceSnapshot(q, { tierId, optionalIds });
  if (error) return error;
  const old = clone(q);
  Object.assign(q, stamp(old, {
    ...q,
    status: "accepted",
    accepted_name: requireSignature ? String(fullName).trim() : null,
    accepted_consent: requireSignature ? true : null,
    accepted_tier_id: isTiered(q) ? snapshot.tier_id : null,
    accepted_selection: { ...snapshot, accepted_via: requireSignature ? "typed-name" : "legacy-button" },
    subtotal: snapshot.subtotal,
    total: snapshot.total,
  }));
  save(state);
  emit("quotes", "UPDATE", q, old);
  return "accepted";
}

async function rpc(client, fn, args = {}) {
  try { await delay(fn === "is_business_user" ? "table" : "rpc"); } catch (e) { return { data: null, error: { message: e.message } }; }
  const state = db();
  const uid = client.session()?.user?.id ?? null;
  if (fn === "is_business_user") {
    if (!uid) return { data: null, error: { code: "42501", message: "permission denied for function is_business_user" } };
    return { data: state.business_users.includes(uid), error: null };
  }
  if (uid) return { data: null, error: { code: "42501", message: `permission denied for function ${fn}` } }; // public RPCs are anon-only
  const token = args.p_token;
  switch (fn) {
    case "get_public_quote": {
      if (!TOKEN_RE.test(String(token ?? ""))) return { data: [], error: null };
      const q = state.quotes.find((r) => r.id === token && r.status !== "draft");
      return { data: q ? [publicRow(q)] : [], error: null };
    }
    case "mark_public_quote_viewed": {
      const q = state.quotes.find((r) => r.id === token && r.status === "sent");
      if (q) { const old = clone(q); Object.assign(q, stamp(old, { ...q, status: "viewed" })); save(state); emit("quotes", "UPDATE", q, old); }
      return { data: null, error: null };
    }
    case "accept_public_quote":
      return { data: acceptAsCustomer(state, token, { requireSignature: false }) === "accepted", error: null };
    case "accept_public_quote_v2":
      if (legacy()) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.accept_public_quote_v2" } };
      return {
        data: acceptAsCustomer(state, token, {
          fullName: args.p_full_name, consent: args.p_consent, tierId: args.p_tier_id,
          optionalIds: args.p_optional_ids ?? [], requireSignature: true,
        }),
        error: null,
      };
    default:
      return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
  }
}

// --- client --------------------------------------------------------------------
export function createMockClient({ anonOnly = false } = {}) {
  const authListeners = new Set();
  const session = () => {
    if (anonOnly) return null;
    const raw = ls.get(SESSION_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const notify = (event) => { for (const l of authListeners) l(event, session()); };

  const client = {
    session,
    auth: {
      async getSession() { return { data: { session: session() }, error: null }; },
      onAuthStateChange(cb) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }) {
        await new Promise((r) => setTimeout(r, 300));
        if (!email || password === "wrong") {
          return { data: null, error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 } };
        }
        const s = { access_token: "mock", user: { id: MOCK_OWNER_ID, email } };
        ls.set(SESSION_KEY, JSON.stringify(s));
        notify("SIGNED_IN");
        return { data: { session: s }, error: null };
      },
      async signOut() { ls.del(SESSION_KEY); notify("SIGNED_OUT"); return { error: null }; },
    },
    from: (table) => new Query(client, table),
    rpc: (fn, args) => rpc(client, fn, args),
    storage: {
      from: () => ({
        async upload(path, file) {
          await delay("table");
          if (!session()) return { data: null, error: { message: "Not signed in" } };
          const dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(file);
          });
          const state = db();
          state.files[path] = dataUrl;
          save(state);
          return { data: { path }, error: null };
        },
        getPublicUrl(path) { return { data: { publicUrl: db().files[path] ?? "" } }; },
      }),
    },
    channel() {
      const handlers = [];
      const ch = {
        on(_type, filter, cb) { handlers.push({ filter, cb }); return ch; },
        subscribe(statusCb) {
          ch.listener = (p) => { for (const h of handlers) if (!h.filter?.table || h.filter.table === p.table) h.cb(p); };
          listeners.add(ch.listener);
          channelBus();
          setTimeout(() => statusCb?.("SUBSCRIBED"), 50);
          return ch;
        },
      };
      return ch;
    },
    removeChannel(ch) { listeners.delete(ch.listener); },
  };
  return client;
}
