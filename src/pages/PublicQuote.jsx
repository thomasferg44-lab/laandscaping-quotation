import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, supabasePublic } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import { makeMoneyFormatter } from "../lib/lineItems";
import { makeCentsFormatter } from "../lib/money";
import { acceptPublicQuoteV2, fetchPublicQuote, markPublicQuoteViewed } from "../lib/publicQuote";
import { docLabel, docRef, isInvoiceStatus } from "../lib/quoteDoc";
import {
  acceptedDocument, baseCents, depositSplit, includedItems, isAcceptedStatus, isExpired, isOptional,
  isTiered, quoteDeposit, quoteTiers, selectionCents, toggleOptional, validateAcceptance,
} from "../lib/quoteMath";
import { normaliseWhatsAppNumber } from "../lib/shareLinks";
import LineItemRow from "../components/LineItemRow.jsx";
import BrandMark from "../components/ui/BrandMark.jsx";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import Sheet from "../components/ui/Sheet.jsx";
import { Field, TextField } from "../components/ui/Field.jsx";

// Hosted, no-login quote page at /quote/:id, opened by the customer, mostly
// on a phone via WhatsApp. It is the client's document, not DropStack's: the
// client's logo/monogram and colour lead; no app shell.
//
// The id in the link is the access token: anon has no table access and
// reads/updates only through get_public_quote, mark_public_quote_viewed and
// accept_public_quote_v2 (publicQuote.js). The server recomputes every total
// at acceptance and refuses expired quotes.
//
// Status transitions performed here:
//   - first open of a 'sent' quote -> 'viewed' (once; skipped when the
//     landscaper is signed in on this device, so previews don't count)
//   - Accept (typed full name + consent tick) -> 'accepted'
export default function PublicQuote() {
  const { id } = useParams();
  const money = useMemo(() => makeMoneyFormatter(companyConfig.currency), []);
  const fmt = useMemo(() => makeCentsFormatter(companyConfig.currency), []);

  const [quote, setQuote] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | notfound | error | offline
  const [slow, setSlow] = useState(false);
  const [tierId, setTierId] = useState(null);
  const [optionalIds, setOptionalIds] = useState([]);
  const [sheet, setSheet] = useState(false);
  const [justAccepted, setJustAccepted] = useState(false);
  const markedViewed = useRef(false); // guard against StrictMode double-effect

  const load = useCallback(async () => {
    setState("loading");
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 2000);
    let data = null;
    try {
      data = await fetchPublicQuote(supabasePublic, id);
    } catch {
      clearTimeout(slowTimer);
      setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error");
      return;
    }
    clearTimeout(slowTimer);
    if (!data) { setState("notfound"); return; }
    setQuote(data);
    setTierId((t) => t ?? quoteTiers(data)[0].id);
    setState("ready");

    if (data.status === "sent" && !markedViewed.current) {
      markedViewed.current = true;
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session) return;
      try {
        await markPublicQuoteViewed(supabasePublic, id); // no-op if it already moved on
        const updated = await fetchPublicQuote(supabasePublic, id);
        if (updated) setQuote(updated);
      } catch { /* viewing still works even if the flip fails */ }
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const back = () => { if (state === "offline" || state === "error") load(); };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [state, load]);

  if (state === "loading") return <Page><LoadingDoc slow={slow} /></Page>;
  if (state === "offline") {
    return <Page><StateCard icon="wifiOff" title="You're offline" body="Connect to the internet to open this quote. It will load as soon as you're back online." action={<button type="button" onClick={load} className="btn-primary w-full">Try again</button>} contact /></Page>;
  }
  if (state === "error") {
    return <Page><StateCard icon="alert" title="This quote didn't load" body="Something went wrong on our side, not yours. Try again, or message us and we'll send it another way." action={<button type="button" onClick={load} className="btn-primary w-full">Try again</button>} contact /></Page>;
  }
  if (state === "notfound") {
    return <Page><StateCard icon="doc" title="Quote not available" body="This link is incomplete, or the quote hasn't been sent yet. Please check the link or contact us." contact /></Page>;
  }

  const tiered = isTiered(quote);
  const tiers = quoteTiers(quote);
  const accepted = isAcceptedStatus(quote.status);
  const expired = !accepted && (quote.is_expired === true || isExpired(quote, new Date(), companyConfig.timeZone));
  const canAccept = (quote.status === "sent" || quote.status === "viewed") && !expired;
  const label = docLabel(quote.status);

  // What's on the page: the frozen acceptance once accepted, else the live choice.
  let items, totalCents, dep, tierName;
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0];
  if (accepted) {
    const d = acceptedDocument(quote);
    items = d.line_items; totalCents = d.totalCents; dep = d.deposit; tierName = d.tierName;
  } else {
    items = tier.line_items;
    totalCents = selectionCents(items, optionalIds);
    const deposit = quoteDeposit(quote);
    dep = deposit ? depositSplit(totalCents, deposit) : null;
    tierName = tiered ? tier.name : null;
  }
  const required = accepted ? items : items.filter((it) => !isOptional(it));
  const optional = accepted ? [] : items.filter(isOptional);
  const pickedOptional = accepted ? items.filter(isOptional) : includedItems(optional, optionalIds);

  function pickTier(id2) {
    setTierId(id2);
    setOptionalIds([]); // add-ons belong to a tier
  }

  async function onAccepted(fresh) {
    if (fresh) setQuote(fresh);
    setSheet(false);
    setJustAccepted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const pdf = async () => {
    const { exportQuotePdf } = await import("../lib/pdfExport");
    await exportQuotePdf(quote);
  };

  return (
    <Page sticky={canAccept && (
      <div className="fixed bottom-0 inset-x-0 z-30 glass-white border-t border-hairline pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="min-w-0">
            <div className="text-[13px] text-ink-3 truncate">{tierName ? `${tierName} · ` : ""}Total</div>
            <div className="text-[22px] font-semibold tabular leading-tight" data-testid="public-total">{fmt(totalCents)}</div>
          </div>
          <button type="button" onClick={() => setSheet(true)} className="btn-primary flex-1 text-[17px]">Accept quote</button>
        </div>
      </div>
    )}>
      {justAccepted && accepted && <SuccessCard quote={quote} fmt={fmt} dep={dep} totalCents={totalCents} onPdf={pdf} />}
      {expired && <ExpiredCard quote={quote} />}
      {quote.is_demo && (
        <p className="mb-3 rounded-input bg-fill px-3.5 py-2.5 text-[13px] text-ink-2">This is a demo quote made from sample data.</p>
      )}

      {/* The document */}
      <article className={`card overflow-hidden ${expired ? "opacity-70" : ""}`} aria-label={`${label} ${docRef(quote)}`}>
        <header className="px-5 sm:px-8 pt-6 sm:pt-8 pb-5 border-b border-hairline">
          <div className="flex items-start justify-between gap-4">
            <div className="text-[13px] font-semibold text-brand tracking-wide">{label}</div>
            <div className="text-[13px] text-ink-3 tabular">{docRef(quote)}</div>
          </div>
          <h1 className="mt-2 text-[26px] sm:text-[30px] leading-tight font-semibold">For {quote.customer_name}</h1>
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-[14px]">
            <Meta label="Date" value={dateLong(quote.created_at)} />
            {quote.valid_until && !accepted && <Meta label="Valid until" value={dateLong(quote.valid_until, true)} warn={expired} />}
            {accepted && quote.accepted_at && <Meta label="Accepted" value={dateLong(quote.accepted_at)} />}
            {isInvoiceStatus(quote.status) && quote.invoiced_at && <Meta label="Invoiced" value={dateLong(quote.invoiced_at)} />}
          </dl>
        </header>

        {/* Tier picker */}
        {tiered && !accepted && (
          <section className="px-5 sm:px-8 pt-5" aria-labelledby="tiers-h">
            <h2 id="tiers-h" className="text-[15px] font-semibold">Choose an option</h2>
            <div role="radiogroup" aria-labelledby="tiers-h" className={`mt-3 grid gap-2 ${tiers.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {tiers.map((t) => {
                const on = t.id === tier.id;
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => canAccept && pickTier(t.id)} disabled={!canAccept}
                    className={`text-left rounded-[14px] border-2 px-4 py-3.5 min-h-[72px] transition-all duration-200 ease-out-soft ${on ? "border-brand bg-brand/[0.04]" : "border-hairline bg-white hover:border-field"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[16px] font-semibold">{t.name}</span>
                      <span className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${on ? "border-brand bg-brand text-brand-ink" : "border-field"}`} aria-hidden>
                        {on && <Icon name="check" size={12} strokeWidth={3} />}
                      </span>
                    </div>
                    <div className="mt-1 text-[17px] font-semibold tabular">{fmt(baseCents(t.line_items))}</div>
                    <div className="text-[13px] text-ink-3">{t.line_items.filter((i) => !isOptional(i)).length} items included</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {accepted && tierName && (
          <p className="px-5 sm:px-8 pt-5 text-[15px]">Option chosen: <span className="font-semibold">{tierName}</span></p>
        )}

        {/* Items */}
        <section className="px-5 sm:px-8 pt-4" aria-label="Items">
          {tiered && !accepted && <h2 className="text-[15px] font-semibold pt-1">{tier.name} includes</h2>}
          <div className="divide-y divide-hairline">
            {required.map((it) => <LineItemRow key={it.id} item={it} formatMoney={money}
              trailing={accepted && isOptional(it) ? <div className="text-[12px] text-info font-semibold">Add-on</div> : null} />)}
          </div>
        </section>

        {/* Optional add-ons */}
        {optional.length > 0 && (
          <section className="px-5 sm:px-8 pt-4" aria-labelledby="addons-h">
            <h2 id="addons-h" className="text-[15px] font-semibold">Optional add-ons</h2>
            <p className="text-[13px] text-ink-3">Tick any you'd like included. The total updates as you go.</p>
            <ul className="mt-2 space-y-2">
              {optional.map((it) => {
                const on = optionalIds.includes(String(it.id));
                return (
                  <li key={it.id}>
                    <label className={`flex items-center gap-3 rounded-[14px] border px-4 py-3 min-h-[60px] ${canAccept ? "cursor-pointer" : ""} ${on ? "border-brand bg-brand/[0.04]" : "border-hairline"}`}>
                      <input type="checkbox" className="sr-only peer" checked={on} disabled={!canAccept}
                        onChange={() => setOptionalIds((cur) => toggleOptional(items, cur, it.id))} />
                      <span className={`h-6 w-6 rounded-[7px] border-2 flex-shrink-0 flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-action-fill ${on ? "bg-brand border-brand text-brand-ink" : "border-field bg-white"}`} aria-hidden>
                        {on && <Icon name="check" size={14} strokeWidth={2.6} />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-medium">{it.description}</span>
                        {it.detail && <span className="block text-[13px] text-ink-3">{it.detail}</span>}
                      </span>
                      <span className="text-[15px] font-semibold tabular whitespace-nowrap">+{money(it.total)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Totals block */}
        <section className="mx-5 sm:mx-8 mt-5 mb-6 rounded-[14px] bg-fill px-4 py-4 space-y-1.5 tabular" aria-label="Totals">
          {pickedOptional.length > 0 && (
            <>
              <Line label="Included items" value={fmt(totalCents - selectionCents(pickedOptional, pickedOptional.map((i) => String(i.id))))} />
              <Line label={`Add-ons (${pickedOptional.length})`} value={fmt(selectionCents(pickedOptional, pickedOptional.map((i) => String(i.id))))} />
            </>
          )}
          <div className="flex items-baseline justify-between gap-4 pt-1">
            <span className="text-[17px] font-semibold">Total</span>
            <span className="text-[26px] font-semibold" data-testid="doc-total">{fmt(totalCents)}</span>
          </div>
          {dep && (
            <div className="border-t border-black/[0.06] mt-2 pt-2.5 space-y-1.5">
              <Line strong label={accepted ? "Deposit due now" : "Deposit due on acceptance"} value={fmt(dep.depositCents)} testid="deposit" />
              <Line label="Balance on completion" value={fmt(dep.balanceCents)} testid="balance" />
            </div>
          )}
        </section>

        {/* Acceptance record + payment instructions */}
        {accepted && (
          <section className="px-5 sm:px-8 pb-6 space-y-4">
            <div className="rounded-[14px] border border-hairline px-4 py-3.5">
              <div className="text-[13px] text-ink-3">Accepted by</div>
              {quote.accepted_name
                ? <div className="text-[19px] font-semibold" style={{ fontFamily: "'Snell Roundhand', 'Segoe Script', 'Bradley Hand', cursive" }}>{quote.accepted_name}</div>
                : <div className="text-[15px] font-medium">{quote.customer_name}</div>}
              <div className="text-[13px] text-ink-3">{quote.accepted_at ? dateTime(quote.accepted_at) : ""}{quote.accepted_name ? " · typed name and consent recorded" : ""}</div>
            </div>
            {companyConfig.paymentInstructions && (dep || isInvoiceStatus(quote.status)) && (
              <div>
                <h2 className="text-[15px] font-semibold">How to pay</h2>
                <p className="text-[14px] text-ink-2 mt-1">{companyConfig.paymentInstructions}</p>
                <p className="text-[13px] text-ink-3 mt-1">Reference: {docRef(quote)}</p>
              </div>
            )}
          </section>
        )}

        {companyConfig.quoteTerms && (
          <p className="px-5 sm:px-8 pb-6 text-[12px] leading-relaxed text-ink-3">{companyConfig.quoteTerms}</p>
        )}
      </article>

      {/* Actions under the document */}
      <div className="mt-4 space-y-2">
        {canAccept && (
          <p className="text-center text-[13px] text-ink-3 px-4">
            Accepting asks {companyConfig.businessName} to go ahead with the work above. You'll type your name to confirm.
          </p>
        )}
        {accepted && !justAccepted && (
          <div className="card px-4 py-3.5 flex items-center gap-3">
            <span className="h-9 w-9 rounded-full bg-good-soft text-good flex items-center justify-center flex-shrink-0"><Icon name="check" size={18} strokeWidth={2.2} /></span>
            <p className="text-[15px]">{isInvoiceStatus(quote.status) ? "This quote was accepted and is now an invoice." : `Accepted. ${companyConfig.businessName} will be in touch to arrange the work.`}</p>
          </div>
        )}
        <PdfButton label={label} onPdf={pdf} />
      </div>

      <AcceptSheet open={sheet} onClose={() => setSheet(false)} quoteId={id} tiered={tiered} tier={tier} tierName={tierName}
        optionalIds={optionalIds} pickedOptional={pickedOptional} totalCents={totalCents} dep={dep} fmt={fmt}
        onAccepted={onAccepted} onRefresh={load} />
    </Page>
  );
}

// --- accept sheet -----------------------------------------------------------
function AcceptSheet({ open, onClose, quoteId, tiered, tier, tierName, optionalIds, pickedOptional, totalCents, dep, fmt, onAccepted, onRefresh }) {
  const [fullName, setFullName] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);
  useEffect(() => { if (open) { setSubmitted(false); setServerError(null); } }, [open]);
  const errors = submitted ? validateAcceptance({ fullName, consent }) : {};

  async function submit(e) {
    e?.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(validateAcceptance({ fullName, consent })).length) return;
    setBusy(true);
    try {
      const r = await acceptPublicQuoteV2(supabasePublic, quoteId,
        { fullName: fullName.trim(), consent, tierId: tiered ? tier.id : null, optionalIds },
        { legacyFallback: !tiered });
      if (r.result === "accepted") onAccepted(r.quote);
      else if (r.result === "expired") { setServerError("This quote has expired, so it can't be accepted. Ask us for an updated quote."); onRefresh(); }
      else if (r.result === "not_open") { setServerError("This quote has already been accepted or changed. We've refreshed the page."); onRefresh(); }
      else if (r.result === "invalid_tier") setServerError("That option is no longer available. Refresh the page and choose again.");
      else if (r.result === "name_required") setServerError("Type your full name to accept.");
      else if (r.result === "consent_required") setServerError("Tick the box to confirm you accept.");
      else setServerError("We couldn't find this quote. Check the link you were sent.");
    } catch {
      setServerError(navigator.onLine === false
        ? "You're offline. Connect to the internet and try again. Nothing was sent."
        : "We couldn't record your acceptance just now. Please try again, or message us.");
    }
    setBusy(false);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Accept this quote"
      footer={
        <button type="button" onClick={submit} disabled={busy} className="btn-primary w-full text-[17px]">
          {busy ? "Accepting…" : `Accept for ${fmt(totalCents)}`}
        </button>
      }>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="rounded-[14px] bg-fill px-4 py-3 text-[14px] space-y-1 tabular">
          {tierName && <Line label="Option" value={tierName} />}
          {pickedOptional.length > 0 && <Line label="Add-ons" value={pickedOptional.map((i) => i.description).join(", ")} />}
          <Line strong label="Total" value={fmt(totalCents)} />
          {dep && <Line label="Deposit due on acceptance" value={fmt(dep.depositCents)} />}
        </div>
        <TextField label="Your full name" data-autofocus autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName} help="Typing your name acts as your signature on this quote." />
        <Field error={errors.consent}>
          {(a) => (
            <label htmlFor={a.id} className="flex items-start gap-3 min-h-[44px] cursor-pointer">
              <input {...a} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-[7px] accent-[rgb(var(--brand-rgb))]" />
              <span className="text-[15px] text-ink-2">
                I accept this quote from {companyConfig.businessName}{tierName ? ` (${tierName})` : ""} for {fmt(totalCents)} and ask them to go ahead with the work.
              </span>
            </label>
          )}
        </Field>
        {serverError && <p className="field-error" role="alert"><Icon name="alert" size={15} className="mt-[1px]" />{serverError}</p>}
      </form>
    </Sheet>
  );
}

// --- designed states ---------------------------------------------------------
function SuccessCard({ quote, fmt, dep, totalCents, onPdf }) {
  return (
    <section className="card p-6 sm:p-8 mb-4 text-center animate-rise" aria-live="polite">
      <div className="mx-auto h-16 w-16 rounded-full bg-good-soft text-good flex items-center justify-center">
        <Icon name="check" size={32} strokeWidth={2} />
      </div>
      <h2 className="mt-4 text-[24px] font-semibold">Quote accepted</h2>
      <p className="mt-1 text-[15px] text-ink-2">
        Thank you{quote.accepted_name ? `, ${quote.accepted_name.split(/\s+/)[0]}` : ""}. {companyConfig.businessName} has your acceptance for {fmt(totalCents)}.
      </p>
      <div className="mt-5 text-left rounded-[14px] bg-fill px-4 py-3.5 text-[14px] space-y-1">
        <div className="font-semibold">What happens next</div>
        <p className="text-ink-2">
          {dep ? `Pay the ${fmt(dep.depositCents)} deposit using the details below, then ` : ""}{companyConfig.businessName} will contact you to schedule the work.
        </p>
      </div>
      <button type="button" onClick={onPdf} className="btn-secondary w-full mt-4 py-3.5"><Icon name="download" size={18} /> Download your copy (PDF)</button>
    </section>
  );
}

function ExpiredCard({ quote }) {
  return (
    <section className="card p-6 mb-4 text-center animate-rise">
      <div className="mx-auto h-14 w-14 rounded-full bg-warn-soft text-warn flex items-center justify-center"><Icon name="clock" size={28} /></div>
      <h2 className="mt-3 text-[20px] font-semibold">This quote has expired</h2>
      <p className="mt-1 text-[15px] text-ink-2">It was valid until {dateLong(quote.valid_until, true)}, so it can no longer be accepted online. Ask us for an updated quote.</p>
      <div className="mt-4"><ContactButtons message={`Hi, my quote ${docRef(quote)} has expired. Could you send me an updated one?`} /></div>
    </section>
  );
}

function StateCard({ icon, title, body, action, contact }) {
  return (
    <section className="card p-6 sm:p-8 text-center animate-rise" role="status">
      <div className="mx-auto h-14 w-14 rounded-full bg-fill text-ink-2 flex items-center justify-center"><Icon name={icon} size={26} /></div>
      <h1 className="mt-3 text-[20px] font-semibold">{title}</h1>
      <p className="mt-1 text-[15px] text-ink-2">{body}</p>
      <div className="mt-5 space-y-2">
        {action}
        {contact && <ContactButtons message="Hi, I'm trying to open the quote you sent me." />}
      </div>
    </section>
  );
}

// Real contact details from config only. The placeholder number in the base
// config doesn't normalise, so no WhatsApp button appears until it's set.
function ContactButtons({ message }) {
  const wa = normaliseWhatsAppNumber(companyConfig.whatsappNumber);
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      {wa && (
        <a href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="btn-secondary flex-1 py-3.5">
          <Icon name="chat" size={18} /> WhatsApp {companyConfig.businessName.split(" ")[0]}
        </a>
      )}
      {wa && <a href={`tel:+${wa}`} className="btn-secondary flex-1 py-3.5"><Icon name="phone" size={18} /> Call</a>}
      {companyConfig.contactEmail && (
        <a href={`mailto:${companyConfig.contactEmail}?subject=${encodeURIComponent("My quote")}`} className="btn-secondary flex-1 py-3.5">
          <Icon name="mail" size={18} /> Email
        </a>
      )}
    </div>
  );
}

function LoadingDoc({ slow }) {
  return (
    <div aria-busy="true" aria-label="Loading quote">
      <div className="card p-6 sm:p-8 space-y-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        <div className="pt-2 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        <Skeleton className="h-24 rounded-[14px]" />
      </div>
      {slow && <p className="mt-4 text-center text-[14px] text-ink-3" role="status">Still loading. Slow connection? Hang on a moment.</p>}
    </div>
  );
}

function PdfButton({ label, onPdf }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <>
      <button type="button" disabled={busy} className="btn-secondary w-full py-3.5"
        onClick={async () => { setBusy(true); setErr(null); try { await onPdf(); } catch { setErr("Couldn't create the PDF. Please try again."); } setBusy(false); }}>
        <Icon name="download" size={18} /> {busy ? "Creating PDF…" : `Download ${label.toLowerCase()} PDF`}
      </button>
      {err && <p className="field-error justify-center">{err}</p>}
    </>
  );
}

// --- page frame: the client's brand, no DropStack shell --------------------
function Page({ children, sticky }) {
  return (
    <div className={`min-h-screen ${sticky ? "pb-32" : "pb-10"}`}>
      <header className="bg-white border-b border-hairline">
        <div className="max-w-2xl mx-auto px-4 h-[60px] flex items-center gap-3">
          <BrandMark size={34} className="rounded-[10px]" />
          <span className="text-[17px] font-semibold truncate">{companyConfig.businessName}</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 pt-5">{children}</main>
      <footer className="max-w-2xl mx-auto px-4 mt-8 text-center text-[12px] text-ink-3 space-y-1">
        <div>{companyConfig.businessName}{companyConfig.contactEmail ? ` · ${companyConfig.contactEmail}` : ""}</div>
        {companyConfig.showPoweredBy && <div className="text-ink-4">Powered by DropStack</div>}
      </footer>
      {sticky}
    </div>
  );
}

function Meta({ label, value, warn }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={`font-medium ${warn ? "text-warn" : ""}`}>{value}</dd>
    </div>
  );
}
function Line({ label, value, strong, testid }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={strong ? "font-semibold" : "text-ink-2"}>{label}</span>
      <span className={`${strong ? "font-semibold" : ""} text-right`} data-testid={testid}>{value}</span>
    </div>
  );
}
const dateLong = (iso, dateOnly) => new Date(dateOnly ? `${String(iso).slice(0, 10)}T12:00:00Z` : iso)
  .toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: companyConfig.timeZone });
const dateTime = (iso) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: companyConfig.timeZone });
