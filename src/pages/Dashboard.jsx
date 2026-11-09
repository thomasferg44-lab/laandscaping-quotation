import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { companyConfig } from "../../companyConfig";
import { makeCentsFormatter, sumCents, toCents } from "../lib/money";
import { docRef } from "../lib/quoteDoc";
import { canFollowUp, displayStatus, fromPriceCents, isTiered } from "../lib/quoteMath";
import { buildFollowUpUrl } from "../lib/shareLinks";
import AppShell from "../components/AppShell.jsx";
import StatusBadge, { DemoBadge } from "../components/StatusBadge.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import useCountUp from "../hooks/useCountUp";
import useDemoData from "../hooks/useDemoData";
import { useQuotes } from "../state/QuotesStore.jsx";

// The 3-second screen: how much (hero strip), what's happening (live list),
// what needs me (the strip under the hero). Live via QuotesStore.
const FILTERS = ["all", "draft", "sent", "viewed", "accepted", "invoiced", "paid", "expired"];
const FILTER_LABEL = { all: "All", draft: "Drafts", sent: "Sent", viewed: "Viewed", accepted: "Accepted", invoiced: "Invoiced", paid: "Paid", expired: "Expired" };
const SORTS = {
  updated:  { label: "Last activity", fn: (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) },
  newest:   { label: "Newest",        fn: (a, b) => String(b.created_at).localeCompare(String(a.created_at)) },
  oldest:   { label: "Oldest",        fn: (a, b) => String(a.created_at).localeCompare(String(b.created_at)) },
  total:    { label: "Highest total", fn: (a, b) => toCents(b.total) - toCents(a.total) },
  customer: { label: "Customer A–Z",  fn: (a, b) => a.customer_name.localeCompare(b.customer_name) },
};

export default function Dashboard() {
  const fmt = useMemo(() => makeCentsFormatter(companyConfig.currency), []);
  const { quotes, error, live, reload, badges, flashId } = useQuotes();
  const [filter, setFilter] = useState(() => readPref("dash.filter", "all"));
  const [sort, setSort] = useState(() => readPref("dash.sort", "updated"));
  const [search, setSearch] = useState("");
  const demo = useDemoData();
  const now = new Date();
  const tz = companyConfig.timeZone;

  const withStatus = useMemo(() => (quotes ?? []).map((q) => ({ ...q, _status: displayStatus(q, now, tz) })), [quotes]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c = { all: withStatus.length };
    for (const f of FILTERS.slice(1)) c[f] = withStatus.filter((q) => q._status === f).length;
    return c;
  }, [withStatus]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return withStatus
      .filter((q) => filter === "all" || q._status === filter)
      .filter((q) => !term || q.customer_name.toLowerCase().includes(term) || docRef(q).toLowerCase().includes(term))
      .sort(SORTS[sort]?.fn ?? SORTS.updated.fn);
  }, [withStatus, filter, sort, search]);

  const sumOf = (pred) => sumCents(withStatus.filter(pred).map((q) => toCents(q.total)));
  const hero = {
    toInvoice: sumOf((q) => q._status === "accepted"),
    out: sumOf((q) => q._status === "sent" || q._status === "viewed"),
    outCount: withStatus.filter((q) => q._status === "sent" || q._status === "viewed").length,
    unpaid: sumOf((q) => q._status === "invoiced"),
    unpaidCount: counts.invoiced ?? 0,
  };
  const needs = [
    badges.quotes > 0 && { key: "accepted", icon: "invoice", text: `${badges.quotes} accepted, ready to invoice`, onClick: () => setFilter("accepted") },
    counts.viewed > 0 && { key: "viewed", icon: "eye", text: `${counts.viewed} viewed, waiting for a yes`, onClick: () => setFilter("viewed") },
    counts.expired > 0 && { key: "expired", icon: "clock", text: `${counts.expired} expired`, onClick: () => setFilter("expired") },
  ].filter(Boolean);

  const setF = (f) => { setFilter(f); writePref("dash.filter", f); };

  return (
    <AppShell title="Quotes" badges={badges}
      actions={
        <span className="flex items-center gap-1.5 text-[13px] text-ink-3" title={live ? "Updates arrive instantly" : "Checking for updates every 20 seconds"}>
          <span className={`h-2 w-2 rounded-full ${live ? "bg-[#34c759] animate-pulse-dot" : "bg-ink-4"}`} aria-hidden />
          {live ? "Live" : "Updating"}
        </span>
      }>
      {quotes === null && !error ? (
        <DashboardSkeleton />
      ) : error && quotes === null ? (
        <div className="card p-6 text-center space-y-3" role="alert">
          <Icon name="wifiOff" size={28} className="mx-auto text-ink-3" />
          <p className="text-[15px] text-ink-2">Couldn't load your quotes. Check your connection.</p>
          <button type="button" onClick={reload} className="btn-secondary"><Icon name="refresh" size={18} /> Try again</button>
        </div>
      ) : quotes.length === 0 ? (
        <EmptyState icon="doc" title="No quotes yet"
          body="Build your first quote in about a minute, or load demo data to see the tool populated."
          action={<Link to="/builder" className="btn-primary px-6"><Icon name="plus" size={18} /> Create a quote</Link>}
          secondary={
            <button type="button" onClick={demo.load} disabled={Boolean(demo.busy)} className="btn-secondary px-6 py-3.5">
              {demo.busy === "load" ? "Loading demo data…" : "Load demo data"}
            </button>
          } />
      ) : (
        <div className="space-y-5">
          {/* Hero stat strip */}
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-3" aria-label="Summary">
            <HeroStat label="Accepted, to invoice" cents={hero.toInvoice} fmt={fmt} sub={`${counts.accepted} quote${counts.accepted === 1 ? "" : "s"}`} onClick={() => setF("accepted")} lead />
            <HeroStat label="Out with customers" cents={hero.out} fmt={fmt} sub={`${hero.outCount} awaiting a reply`} onClick={() => setF("viewed")} />
            <HeroStat label="Invoiced, unpaid" cents={hero.unpaid} fmt={fmt} sub={`${hero.unpaidCount} invoice${hero.unpaidCount === 1 ? "" : "s"}`} onClick={() => setF("invoiced")} />
          </section>

          {needs.length > 0 && (
            <section aria-label="Needs you" className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
              {needs.map((n) => (
                <button key={n.key} type="button" onClick={n.onClick}
                  className="flex-shrink-0 inline-flex items-center gap-2 rounded-full bg-white shadow-card px-4 min-h-[44px] text-[14px] font-medium hover:bg-fill">
                  <Icon name={n.icon} size={18} className="text-ink-2" /> {n.text}
                </button>
              ))}
            </section>
          )}

          {/* Search + sort */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input type="search" placeholder="Search customer or quote number" aria-label="Search quotes" value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-input bg-fill-2 pl-10 pr-3 min-h-[44px] text-base outline-none focus:shadow-ring" />
            </div>
            <select value={sort} aria-label="Sort" onChange={(e) => { setSort(e.target.value); writePref("dash.sort", e.target.value); }}
              className="rounded-input bg-fill-2 px-3 min-h-[44px] text-base outline-none focus:shadow-ring">
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {/* Filter chips */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter by status">
            {FILTERS.filter((f) => f === "all" || counts[f] > 0 || filter === f).map((f) => {
              const active = filter === f;
              return (
                <button key={f} type="button" role="tab" aria-selected={active} onClick={() => setF(f)}
                  className={`flex-shrink-0 rounded-full px-4 min-h-[44px] text-[14px] font-medium transition-colors duration-200 ${active ? "bg-ink text-white" : "bg-white text-ink-2 shadow-card hover:text-ink"}`}>
                  {FILTER_LABEL[f]} <span className={`tabular ${active ? "text-white/70" : "text-ink-3"}`}>{counts[f] ?? 0}</span>
                </button>
              );
            })}
          </div>

          {error && <p className="text-[13px] text-warn">Showing the last loaded list. Reconnecting…</p>}

          {visible.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-[15px] text-ink-2">Nothing matches this filter.</p>
              <button type="button" onClick={() => { setF("all"); setSearch(""); }} className="btn-plain mt-2">Show all quotes</button>
            </div>
          ) : (
            <ul className="card divide-y divide-hairline overflow-hidden" aria-label="Quotes">
              {visible.map((q) => <QuoteRow key={q.id} q={q} fmt={fmt} flash={q.id === flashId} />)}
            </ul>
          )}
        </div>
      )}

      {/* Phone: primary action in the thumb zone */}
      {quotes?.length > 0 && (
        <Link to="/builder" className="lg:hidden fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-20 btn-primary rounded-full shadow-lift px-5">
          <Icon name="plus" size={20} /> New quote
        </Link>
      )}
      {demo.error && <p className="mt-4 field-error justify-center">{demo.error}</p>}
    </AppShell>
  );
}

function HeroStat({ label, cents, fmt, sub, onClick, lead }) {
  const v = useCountUp(cents);
  return (
    <button type="button" onClick={onClick}
      className={`card text-left transition-transform duration-200 ease-out-soft active:scale-[0.99] ${lead ? "aura-wash col-span-2 sm:col-span-1 p-5" : "p-4 sm:p-5"}`}>
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className={`mt-1 leading-tight font-semibold tabular truncate ${lead ? "text-[36px] sm:text-[28px] lg:text-[32px]" : "text-[22px] sm:text-[28px] lg:text-[32px]"}`}>{fmt(v)}</div>
      <div className="mt-0.5 text-[13px] text-ink-3">{sub}</div>
    </button>
  );
}

function QuoteRow({ q, fmt, flash }) {
  const tiered = isTiered(q);
  const amount = tiered && !q.accepted_selection ? fromPriceCents(q) : toCents(q.total);
  const follow = canFollowUp(q, new Date(), companyConfig.timeZone)
    ? buildFollowUpUrl({ quote: q, ref: docRef(q), totalText: `${tiered ? "from " : ""}${fmt(amount)}`.replace(/[  ]/g, " ") })
    : null;
  return (
    <li className={`flex items-stretch ${flash ? "animate-flash" : ""}`}>
      <Link to={`/quotes/${q.id}`} className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 min-h-[64px] hover:bg-fill/60">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-semibold truncate">{q.customer_name}</span>
            {q.is_demo && <DemoBadge />}
          </div>
          <div className="text-[13px] text-ink-3 truncate tabular">
            {docRef(q)} · {subline(q)}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[15px] font-semibold tabular whitespace-nowrap">{tiered && !q.accepted_selection && <span className="text-[13px] font-normal text-ink-3">from </span>}{fmt(amount)}</div>
          <StatusBadge status={q._status} className="mt-1" />
        </div>
      </Link>
      {follow && (
        <a href={follow} target="_blank" rel="noreferrer" aria-label={`Follow up with ${q.customer_name} on WhatsApp`} title="Follow up on WhatsApp"
          className="flex items-center justify-center w-12 border-l border-hairline text-action hover:bg-fill/60">
          <Icon name="chat" />
        </a>
      )}
    </li>
  );
}

function subline(q) {
  if (q._status === "expired") return `expired ${dateShort(q.valid_until)}`;
  if (q.status === "accepted" && q.accepted_at) return `accepted ${relative(q.accepted_at)}`;
  if (q.status === "viewed" && q.viewed_at) return `viewed ${relative(q.viewed_at)}`;
  if (q.status === "sent" && q.sent_at) return `sent ${relative(q.sent_at)}`;
  if (q.status === "invoiced" && q.invoiced_at) return `invoiced ${relative(q.invoiced_at)}`;
  return dateShort(q.created_at);
}
const dateShort = (iso) => new Date(String(iso).length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
function relative(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading quotes">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[112px] rounded-card" />)}</div>
      <Skeleton className="h-11" />
      <div className="card divide-y divide-hairline">{[0, 1, 2, 3].map((i) => <div key={i} className="p-4 flex gap-3"><Skeleton className="h-10 flex-1" /><Skeleton className="h-10 w-24" /></div>)}</div>
    </div>
  );
}

function readPref(k, fallback) { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } }
function writePref(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
