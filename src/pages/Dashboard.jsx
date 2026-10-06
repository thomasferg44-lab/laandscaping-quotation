import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import { makeMoneyFormatter } from "../lib/lineItems";
import { fromCents, sumCents, toCents } from "../lib/money";
import { docRef } from "../lib/quoteDoc";
import StatusBadge from "../components/StatusBadge.jsx";

// Landscaper's landing page: every quote/invoice, filterable by status.
//
// Live updates: hybrid of Supabase Realtime + polling.
//  - Realtime (postgres_changes on quotes) gives instant updates when the
//    table is in the supabase_realtime publication (see schema.sql).
//  - A 20s poll while the tab is visible, plus a refetch on focus, covers
//    deploys where realtime isn't enabled or the socket drops. Single-user
//    tool, so the extra reads are negligible.

const STATUS_ORDER = ["draft", "sent", "viewed", "accepted", "invoiced", "paid"];
const POLL_MS = 20000;
const COLUMNS = "id, customer_name, status, total, created_at, updated_at, accepted_at";

const SORTS = {
  newest:   { label: "Newest",        fn: (a, b) => b.created_at.localeCompare(a.created_at) },
  updated:  { label: "Last activity", fn: (a, b) => b.updated_at.localeCompare(a.updated_at) },
  oldest:   { label: "Oldest",        fn: (a, b) => a.created_at.localeCompare(b.created_at) },
  total:    { label: "Highest total", fn: (a, b) => toCents(b.total) - toCents(a.total) },
  customer: { label: "Customer A–Z",  fn: (a, b) => a.customer_name.localeCompare(b.customer_name) },
};

export default function Dashboard() {
  const formatMoney = useMemo(() => makeMoneyFormatter(companyConfig.currency), []);
  const [quotes, setQuotes] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(() => readPref("dash.filter", "all"));
  const [sort, setSort] = useState(() => readPref("dash.sort", "updated"));
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("quotes").select(COLUMNS).order("updated_at", { ascending: false });
    if (error) setError(error.message);
    else { setQuotes(data); setError(null); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime: patch rows in place from change events.
  useEffect(() => {
    const channel = supabase
      .channel("quotes-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, (payload) => {
        setQuotes((prev) => {
          if (!prev) return prev;
          if (payload.eventType === "DELETE") return prev.filter((q) => q.id !== payload.old.id);
          const row = pick(payload.new);
          const i = prev.findIndex((q) => q.id === row.id);
          return i === -1 ? [row, ...prev] : prev.map((q) => (q.id === row.id ? { ...q, ...row } : q));
        });
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Polling + refetch on focus/visibility as the fallback.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const t = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  useEffect(() => writePref("dash.filter", filter), [filter]);
  useEffect(() => writePref("dash.sort", sort), [sort]);

  const counts = useMemo(() => {
    const c = { all: quotes?.length ?? 0 };
    for (const s of STATUS_ORDER) c[s] = 0;
    for (const q of quotes ?? []) c[q.status] = (c[q.status] ?? 0) + 1;
    return c;
  }, [quotes]);

  const visible = useMemo(() => {
    if (!quotes) return [];
    const term = search.trim().toLowerCase();
    return quotes
      .filter((q) => filter === "all" || q.status === filter)
      .filter((q) => !term || q.customer_name.toLowerCase().includes(term))
      .sort(SORTS[sort]?.fn ?? SORTS.updated.fn);
  }, [quotes, filter, sort, search]);

  // "Outstanding" = needs the landscaper's attention or money.
  const outstanding = useMemo(() => {
    const q = quotes ?? [];
    const sum = (s) => fromCents(sumCents(q.filter((x) => x.status === s).map((x) => toCents(x.total))));
    return { accepted: sum("accepted"), invoiced: sum("invoiced"), awaiting: q.filter((x) => x.status === "sent" || x.status === "viewed").length };
  }, [quotes]);

  async function signOut() { await supabase.auth.signOut(); }

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {companyConfig.logoUrl && (
              <img src={companyConfig.logoUrl} alt="" className="h-8 w-8 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
            )}
            <div className="truncate font-semibold" style={{ color: companyConfig.primaryColor }}>{companyConfig.businessName}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400" title={live ? "Realtime connected" : "Polling every 20s"}>{live ? "● live" : "○ polling"}</span>
            <button type="button" onClick={signOut} className="text-sm text-gray-500">Sign out</button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* At-a-glance */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Awaiting reply" value={outstanding.awaiting} onClick={() => setFilter("sent")} />
          <Stat label="Accepted, to invoice" value={formatMoney(outstanding.accepted)} onClick={() => setFilter("accepted")} />
          <Stat label="Invoiced, unpaid" value={formatMoney(outstanding.invoiced)} onClick={() => setFilter("invoiced")} />
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
          {["all", ...STATUS_ORDER].map((s) => {
            const active = filter === s;
            return (
              <button key={s} type="button" onClick={() => setFilter(s)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-sm border capitalize ${active ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
                style={active ? { backgroundColor: companyConfig.primaryColor } : undefined}>
                {s} <span className={active ? "opacity-80" : "text-gray-400"}>{counts[s] ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input type="search" placeholder="Search customer" value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-2 text-base bg-white">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* List */}
        {quotes === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-xl bg-white border border-gray-200 p-6 text-center text-sm text-gray-500">
            {quotes.length === 0 ? "No quotes yet. Tap New quote to build your first one." : "Nothing matches this filter."}
          </div>
        ) : (
          <ul className="rounded-xl bg-white border border-gray-200 divide-y divide-gray-100">
            {visible.map((q) => (
              <li key={q.id}>
                <Link to={`/builder/${q.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{q.customer_name}</div>
                    <div className="text-xs text-gray-500">
                      {docRef(q)} · {new Date(q.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                      {q.status === "accepted" && q.accepted_at && ` · accepted ${relative(q.accepted_at)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold whitespace-nowrap">{formatMoney(q.total)}</div>
                    <StatusBadge status={q.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Link to="/builder"
        className="fixed bottom-5 right-5 rounded-full px-5 py-3 text-white font-medium shadow-lg"
        style={{ backgroundColor: companyConfig.primaryColor }}>
        + New quote
      </Link>
    </div>
  );
}

function Stat({ label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl bg-white border border-gray-200 p-3 text-left hover:bg-gray-50">
      <div className="text-xs text-gray-500 leading-tight">{label}</div>
      <div className="font-semibold mt-1 truncate">{value}</div>
    </button>
  );
}

function pick(row) {
  const out = {};
  for (const k of COLUMNS.split(", ")) out[k] = row[k];
  return out;
}

function relative(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function readPref(k, fallback) { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } }
function writePref(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
