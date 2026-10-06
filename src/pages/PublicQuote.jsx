import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, supabasePublic } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import { makeMoneyFormatter } from "../lib/lineItems";
import { acceptPublicQuote, fetchPublicQuote, markPublicQuoteViewed } from "../lib/publicQuote";
import { exportQuotePdf } from "../lib/pdfExport";
import { docLabel, isInvoiceStatus } from "../lib/quoteDoc";
import LineItemRow from "../components/LineItemRow.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

// Hosted, no-login quote page at /quote/:id. Opened by the customer, mostly on
// a phone via WhatsApp. The id in the link is the access token: anon has no
// table access and reads/updates only through the get_public_quote,
// mark_public_quote_viewed and accept_public_quote functions (publicQuote.js),
// which never return drafts and only allow sent->viewed, sent|viewed->accepted.
//
// Status transitions performed here:
//   - first open of a 'sent' quote  -> 'viewed'  (once; reloads are no-ops
//     because the row is already 'viewed')
//   - Accept button                 -> 'accepted'
// viewed_at / accepted_at are stamped server-side.
export default function PublicQuote() {
  const { id } = useParams();
  const formatMoney = useMemo(() => makeMoneyFormatter(companyConfig.currency), []);

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const markedViewed = useRef(false); // guard against StrictMode double-effect

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let data = null;
      try {
        data = await fetchPublicQuote(supabasePublic, id);
      } catch {
        /* network/server error: show the same message as a bad link */
      }
      if (cancelled) return;
      if (!data) {
        // Drafts, unknown and malformed tokens all come back empty.
        setNotFound(true);
        setLoading(false);
        return;
      }
      setQuote(data);
      setLoading(false);

      // Flip sent -> viewed on first open only. Skip when the landscaper is
      // signed in (previewing their own quote should not count as a view).
      if (data.status === "sent" && !markedViewed.current) {
        markedViewed.current = true;
        const { data: sess } = await supabase.auth.getSession();
        if (sess.session) return;
        try {
          await markPublicQuoteViewed(supabasePublic, id); // no-op if it already moved on
          const updated = await fetchPublicQuote(supabasePublic, id);
          if (!cancelled && updated) setQuote(updated);
        } catch {
          /* viewing still works even if the flip fails */
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  async function accept() {
    if (!quote) return;
    setAccepting(true);
    setError(null);
    let result;
    try {
      result = await acceptPublicQuote(supabasePublic, id);
    } catch {
      setAccepting(false);
      setError("Sorry, we couldn't record your acceptance. Please try again or contact us.");
      return;
    }
    setAccepting(false);
    // Fresh copy either way: if it was already accepted elsewhere, show that.
    if (result.quote) setQuote(result.quote);
  }

  if (loading) return <Shell><p className="text-sm text-gray-500">Loading quote…</p></Shell>;

  if (notFound) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Quote not available</h1>
        <p className="text-sm text-gray-600 mt-2">
          This link is invalid, or the quote hasn't been sent yet. Please contact {companyConfig.businessName}
          {companyConfig.contactEmail ? ` at ${companyConfig.contactEmail}` : ""}.
        </p>
      </Shell>
    );
  }

  const isInvoice = isInvoiceStatus(quote.status);
  const canAccept = quote.status === "sent" || quote.status === "viewed";
  const accepted = quote.status === "accepted" || isInvoice;
  const label = docLabel(quote.status);

  async function downloadPdf() {
    setExporting(true);
    try { await exportQuotePdf(quote); } catch { setError("Couldn't generate the PDF. Please try again."); }
    setExporting(false);
  }
  const created = new Date(quote.created_at);

  return (
    <Shell>
      {/* Header block */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
          <h1 className="text-xl font-semibold">{quote.customer_name}</h1>
          <div className="text-sm text-gray-500">{created.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
        <StatusBadge status={quote.status} />
      </div>

      {/* Line items */}
      <div className="mt-6 rounded-xl bg-white border border-gray-200 px-4">
        {quote.line_items.map((it) => (
          <LineItemRow key={it.id} item={it} formatMoney={formatMoney} />
        ))}
      </div>

      {/* Totals */}
      <div className="mt-4 rounded-xl bg-white border border-gray-200 p-4 space-y-1">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Subtotal</span><span>{formatMoney(quote.subtotal)}</span>
        </div>
        <div className="flex justify-between text-lg font-semibold">
          <span>Total</span><span>{formatMoney(quote.total)}</span>
        </div>
      </div>

      {/* Accept / status feedback */}
      <div className="mt-6">
        {canAccept && (
          <>
            <button type="button" onClick={accept} disabled={accepting}
              className="w-full rounded-xl py-3 text-white text-base font-semibold disabled:opacity-60"
              style={{ backgroundColor: companyConfig.primaryColor }}>
              {accepting ? "Accepting…" : "Accept this quote"}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              By accepting, you confirm you'd like {companyConfig.businessName} to go ahead with the work above.
            </p>
          </>
        )}
        {accepted && (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 text-sm">
            <div className="font-semibold">
              {isInvoice ? "This quote was accepted and is now an invoice." : "Quote accepted. Thank you!"}
            </div>
            {quote.accepted_at && (
              <div className="text-xs mt-1">Accepted on {new Date(quote.accepted_at).toLocaleString("en-ZA")}</div>
            )}
            <div className="mt-1">{companyConfig.businessName} will be in touch to arrange the work.</div>
          </div>
        )}
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        <button type="button" onClick={downloadPdf} disabled={exporting}
          className="mt-3 w-full rounded-xl border border-gray-300 bg-white py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-60">
          {exporting ? "Generating…" : `⬇️ Download ${label} PDF`}
        </button>
      </div>

      <footer className="mt-8 text-center text-xs text-gray-400">
        {companyConfig.businessName}
        {companyConfig.contactEmail ? ` · ${companyConfig.contactEmail}` : ""}
      </footer>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          {companyConfig.logoUrl && (
            <img src={companyConfig.logoUrl} alt="" className="h-8 w-8 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
          <span className="font-semibold" style={{ color: companyConfig.primaryColor }}>{companyConfig.businessName}</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
