import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import { getQuote } from "../lib/quotesApi";
import { advanceStatus } from "../lib/quoteStatus";
import { exportQuotePdf } from "../lib/pdfExport";
import { makeMoneyFormatter } from "../lib/lineItems";
import { makeCentsFormatter, toCents } from "../lib/money";
import { docLabel, docRef, isInvoiceStatus } from "../lib/quoteDoc";
import {
  acceptedDocument, baseCents, canFollowUp, depositSplit, displayStatus, fromPriceCents,
  isAcceptedStatus, isOptional, isTiered, quoteDeposit, quoteTiers,
} from "../lib/quoteMath";
import { buildFollowUpUrl } from "../lib/shareLinks";
import AppShell from "../components/AppShell.jsx";
import StatusBadge, { DemoBadge } from "../components/StatusBadge.jsx";
import ShareButtons from "../components/ShareButtons.jsx";
import Timeline from "../components/Timeline.jsx";
import LineItemRow from "../components/LineItemRow.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import PaymentBlock from "../components/PaymentBlock.jsx";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useQuotes } from "../state/QuotesStore.jsx";

// Detail screen (spec §3): summary card first, then the one primary action,
// then acceptance details and history. Live: picks up realtime/poll updates
// from QuotesStore, so an acceptance shows up here without a reload.
export default function QuoteDetail() {
  const { id } = useParams();
  const toast = useToast();
  const store = useQuotes();
  const money = useMemo(() => makeMoneyFormatter(companyConfig.currency), []);
  const fmt = useMemo(() => makeCentsFormatter(companyConfig.currency), []);
  const [fetched, setFetched] = useState(null);
  const [state, setState] = useState("loading");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getQuote(supabase, id)
      .then((row) => { if (!cancelled) { setFetched(row); setState(row ? "ready" : "missing"); } })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [id]);

  const live = store?.quotes?.find((q) => q.id === id);
  const quote = live && fetched ? { ...fetched, ...live } : live ?? fetched;

  if (state === "loading" && !quote) {
    return <AppShell title="Quote" back={{ to: "/", label: "Quotes" }}><div className="space-y-4"><Skeleton className="h-40 rounded-card" /><Skeleton className="h-14" /><Skeleton className="h-64 rounded-card" /></div></AppShell>;
  }
  if (!quote) {
    return (
      <AppShell title="Quote" back={{ to: "/", label: "Quotes" }}>
        <div className="card p-6 text-center space-y-3">
          <p className="text-[15px] text-ink-2">{state === "error" ? "Couldn't load this quote. Check your connection." : "This quote doesn't exist, or you don't have access to it."}</p>
          <Link to="/" className="btn-secondary">Back to quotes</Link>
        </div>
      </AppShell>
    );
  }

  const status = displayStatus(quote, new Date(), companyConfig.timeZone);
  const accepted = isAcceptedStatus(quote.status);
  const tiered = isTiered(quote);
  const doc = accepted ? acceptedDocument(quote) : null;
  const amountCents = accepted ? doc.totalCents : tiered ? fromPriceCents(quote) : toCents(quote.total);
  const dep = accepted ? doc.deposit : quoteDeposit(quote) ? depositSplit(amountCents, quoteDeposit(quote)) : null;
  const locked = accepted && Boolean(quote.accepted_selection);
  const followUrl = canFollowUp(quote, new Date(), companyConfig.timeZone)
    ? buildFollowUpUrl({ quote, ref: docRef(quote), totalText: `${tiered ? "from " : ""}${fmt(amountCents)}`.replace(/[  ]/g, " ") })
    : null;

  async function convert() {
    setBusy("convert"); setErr(null);
    try {
      const row = await advanceStatus(id, "accepted", "invoiced");
      if (row) { setFetched((f) => ({ ...f, ...row })); store?.upsertLocal(row); setConfirm(false); toast("Converted to an invoice"); }
      else setErr("This quote is no longer waiting to be invoiced. Reload to see its current status.");
    } catch { setErr("Couldn't convert. Check your connection and try again."); }
    setBusy(null);
  }
  async function pdf() {
    setBusy("pdf");
    try { await exportQuotePdf(quote); } catch { toast("Couldn't create the PDF. Try again"); }
    setBusy(null);
  }

  const primary =
    quote.status === "accepted" ? (
      <button type="button" onClick={() => setConfirm(true)} className="btn-primary w-full text-[17px]"><Icon name="invoice" /> Convert to invoice</button>
    ) : followUrl ? (
      <a href={followUrl} target="_blank" rel="noreferrer" className="btn-primary w-full text-[17px]"><Icon name="chat" /> Follow up on WhatsApp</a>
    ) : isInvoiceStatus(quote.status) || status === "expired" ? (
      <button type="button" onClick={pdf} disabled={busy === "pdf"} className="btn-primary w-full text-[17px]"><Icon name="download" /> {busy === "pdf" ? "Creating PDF…" : `Download ${docLabel(quote.status).toLowerCase()} PDF`}</button>
    ) : null;

  return (
    <AppShell title={docRef(quote)} back={{ to: "/", label: "Quotes" }} badges={store?.badges}>
      <div className="space-y-5">
        {/* Summary */}
        <section className="card p-5 sm:p-6 space-y-4 animate-rise">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h2 className="text-[22px] font-semibold truncate">{quote.customer_name}</h2>{quote.is_demo && <DemoBadge />}</div>
              <div className="text-[13px] text-ink-3">{docLabel(quote.status)} {docRef(quote)} · created {dateLong(quote.created_at)}</div>
            </div>
            <StatusBadge status={status} />
          </div>
          <div>
            <div className="text-[13px] text-ink-3">{accepted ? "Accepted total" : tiered ? "From (cheapest option)" : "Total"}</div>
            <div className="text-[36px] leading-tight font-semibold tabular">{fmt(amountCents)}</div>
            {dep && (
              <div className="mt-1 text-[14px] text-ink-2 tabular">Deposit {fmt(dep.depositCents)} on acceptance · balance {fmt(dep.balanceCents)}</div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-[14px]">
            {quote.customer_phone && <Info label="WhatsApp" value={quote.customer_phone} />}
            {quote.customer_email && <Info label="Email" value={quote.customer_email} />}
            {tiered && <Info label="Options" value={quoteTiers(quote).map((t) => t.name).join(" / ")} />}
            {quote.valid_until && !accepted && <Info label="Valid until" value={dateLong(quote.valid_until, true)} />}
          </dl>
        </section>

        {/* Primary action, then the rest */}
        {primary}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {!locked && <Link to={`/builder/${id}`} className="btn-secondary"><Icon name="edit" size={18} /> Edit</Link>}
          {quote.status !== "draft" && <a href={`/quote/${id}`} target="_blank" rel="noreferrer" className="btn-secondary"><Icon name="eye" size={18} /> Customer view</a>}
          {!(isInvoiceStatus(quote.status) || status === "expired") && (
            <button type="button" onClick={pdf} disabled={busy === "pdf"} className="btn-secondary"><Icon name="download" size={18} /> {busy === "pdf" ? "Creating…" : "PDF"}</button>
          )}
        </div>

        {/* Acceptance record */}
        {accepted && (
          <section className="card p-5 space-y-3" aria-labelledby="acc-h">
            <h2 id="acc-h" className="text-[17px] font-semibold flex items-center gap-2"><Icon name="pen" size={18} /> Acceptance</h2>
            {quote.accepted_name ? (
              <>
                <p className="text-[15px]">Accepted by <span className="font-semibold">{quote.accepted_name}</span>, typed as their full name, with the consent box ticked.</p>
                <dl className="grid grid-cols-2 gap-3 text-[14px]">
                  <Info label="Accepted" value={quote.accepted_at ? dateTime(quote.accepted_at) : "Time not recorded"} />
                  {doc.tierName && <Info label="Option chosen" value={doc.tierName} />}
                  {doc.line_items.some(isOptional) && <Info label="Add-ons chosen" value={doc.line_items.filter(isOptional).map((i) => i.description).join(", ")} />}
                </dl>
              </>
            ) : (
              <p className="text-[15px] text-ink-2">
                Accepted {quote.accepted_at ? dateTime(quote.accepted_at) : ""} with the one-tap button. No typed name: this quote was accepted before name signatures were switched on.
              </p>
            )}
          </section>
        )}

        {/* Items */}
        <section className="card p-5" aria-labelledby="items-h">
          <h2 id="items-h" className="text-[17px] font-semibold mb-1">{accepted ? "What the customer accepted" : tiered ? "Options offered" : "Items"}</h2>
          {accepted ? (
            <div className="divide-y divide-hairline">{doc.line_items.map((it) => <LineItemRow key={it.id} item={it} formatMoney={money} />)}</div>
          ) : (
            quoteTiers(quote).map((t) => (
              <div key={t.id} className="mt-2">
                {tiered && <div className="flex justify-between text-[14px] font-semibold pt-3"><span>{t.name}</span><span className="tabular">{fmt(baseCents(t.line_items))}</span></div>}
                <div className="divide-y divide-hairline">
                  {t.line_items.map((it) => (
                    <LineItemRow key={it.id} item={it} formatMoney={money} muted={isOptional(it)}
                      trailing={isOptional(it) ? <div className="text-[12px] text-info font-semibold">Optional</div> : null} />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>

        {isInvoiceStatus(quote.status) && (
          <section className="card p-5">
            <PaymentBlock quote={quote} reference={docRef(quote)} compact />
            <p className="mt-3 text-[13px] text-ink-3">This is what the customer sees on their invoice link and PDF.</p>
          </section>
        )}

        {(quote.status === "draft" || quote.status === "sent" || quote.status === "viewed") && status !== "expired" && (
          <ShareButtons quote={quote} onStatusChange={(row) => { setFetched((f) => ({ ...f, ...row })); store?.upsertLocal(row); }} />
        )}

        <section className="card p-5" aria-labelledby="hist-h">
          <h2 id="hist-h" className="text-[17px] font-semibold mb-4">History</h2>
          <Timeline quote={quote} />
        </section>
      </div>

      <ConfirmSheet open={confirm} onClose={() => setConfirm(false)} title="Convert to invoice?" confirmLabel="Convert to invoice"
        onConfirm={convert} busy={busy === "convert"} error={err}
        body={<>
          <p>The customer's link and PDF will show an invoice for {fmt(amountCents)}{dep ? `, with the ${fmt(dep.depositCents)} deposit and ${fmt(dep.balanceCents)} balance` : ""}.</p>
          <p>Every item stays exactly as accepted. Only the status changes.</p>
        </>} />
    </AppShell>
  );
}

function Info({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
const dateLong = (iso, dateOnly) => new Date(dateOnly ? `${String(iso).slice(0, 10)}T12:00:00Z` : iso)
  .toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: companyConfig.timeZone });
const dateTime = (iso) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: companyConfig.timeZone });
