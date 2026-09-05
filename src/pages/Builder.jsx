import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import {
  MODE_KEYS,
  MODES,
  makeMoneyFormatter,
  newLineItem,
  serialiseLineItem,
  sumLineItems,
} from "../lib/lineItems";
import LineItemEditor from "../components/LineItemEditor.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ShareButtons from "../components/ShareButtons.jsx";
import { advanceStatus } from "../lib/quoteStatus";
import { exportQuotePdf } from "../lib/pdfExport";
import { docLabel, isInvoiceStatus } from "../lib/quoteDoc";

// Stage 1: build and save a quote (status 'draft'). Sharing, the public page,
// invoice conversion, PDF and the dashboard are later build-order stages.
export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const formatMoney = useMemo(() => makeMoneyFormatter(companyConfig.currency), []);

  const [quote, setQuote] = useState({
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    line_items: [newLineItem("area")],
    status: "draft",
  });
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false); // unsaved edits since last save/load
  const [converting, setConverting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Load an existing draft when /builder/:id
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    supabase
      .from("quotes")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setQuote({ ...data, customer_phone: data.customer_phone ?? "", customer_email: data.customer_email ?? "" });
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const subtotal = sumLineItems(quote.line_items);
  const total = subtotal; // VAT/discount are not in the v1 spec; keep the column for later.

  function setField(k, v) {
    setDirty(true);
    setQuote((q) => ({ ...q, [k]: v }));
  }
  function updateItem(next) {
    setDirty(true);
    setQuote((q) => ({ ...q, line_items: q.line_items.map((it) => (it.id === next.id ? next : it)) }));
  }
  function removeItem(itemId) {
    setDirty(true);
    setQuote((q) => ({ ...q, line_items: q.line_items.filter((it) => it.id !== itemId) }));
  }
  function addItem(mode) {
    setDirty(true);
    setQuote((q) => ({ ...q, line_items: [...q.line_items, newLineItem(mode)] }));
  }

  async function save(e) {
    e?.preventDefault();
    setError(null);
    if (!quote.customer_name.trim()) {
      setError("Customer name is required.");
      return;
    }
    const items = quote.line_items.map(serialiseLineItem).filter((it) => it.description || it.total);
    if (items.length === 0) {
      setError("Add at least one line item with a description.");
      return;
    }
    setSaving(true);
    const payload = {
      customer_name: quote.customer_name.trim(),
      customer_phone: quote.customer_phone.trim() || null,
      customer_email: quote.customer_email.trim() || null,
      line_items: items,
      subtotal: sumLineItems(items),
      total: sumLineItems(items),
    };
    let res;
    if (id) {
      res = await supabase.from("quotes").update(payload).eq("id", id).select().single();
    } else {
      res = await supabase.from("quotes").insert({ ...payload, status: "draft" }).select().single();
    }
    setSaving(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setSavedAt(new Date());
    setDirty(false);
    setQuote((q) => ({ ...q, ...res.data, customer_phone: res.data.customer_phone ?? "", customer_email: res.data.customer_email ?? "" }));
    if (!id) navigate(`/builder/${res.data.id}`, { replace: true });
  }

  // Convert to invoice: same record, same line items, only status changes.
  // Goes through the shared guarded status path; invoiced_at is stamped by
  // the DB trigger.
  async function convertToInvoice() {
    if (!window.confirm("Convert this accepted quote to an invoice? The customer's link will now show an invoice.")) return;
    setConverting(true);
    setError(null);
    try {
      const row = await advanceStatus(id, "accepted", "invoiced");
      if (row) setQuote((q) => ({ ...q, ...row }));
      else setError("Quote is no longer in 'accepted' state. Reload to see its current status.");
    } catch (e) {
      setError(e.message);
    }
    setConverting(false);
  }

  async function downloadPdf() {
    setExporting(true);
    setError(null);
    try {
      // Export what is saved, not the unsaved form state, so PDF == hosted page.
      const items = quote.line_items.map(serialiseLineItem);
      await exportQuotePdf({ ...quote, id, line_items: items, subtotal: sumLineItems(items), total: sumLineItems(items) });
    } catch (e) {
      setError(`PDF export failed: ${e.message}`);
    }
    setExporting(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading quote…</div>;

  const isDraft = quote.status === "draft";

  return (
    <div className="min-h-screen pb-32">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/" className="text-sm text-gray-500 whitespace-nowrap">← Quotes</Link>
            {companyConfig.logoUrl && (
              <img src={companyConfig.logoUrl} alt="" className="h-8 w-8 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
            )}
            <div className="truncate font-semibold" style={{ color: companyConfig.primaryColor }}>
              {companyConfig.businessName}
            </div>
          </div>
          <button type="button" onClick={signOut} className="text-sm text-gray-500">Sign out</button>
        </div>
      </header>

      <form onSubmit={save} className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">{id ? `Edit ${docLabel(quote.status).toLowerCase()}` : "New quote"}</h1>
            <div className="flex items-center gap-3">
              {id && !isDraft && (
                <a href={`/quote/${id}`} target="_blank" rel="noreferrer" className="text-sm underline text-gray-600">
                  Preview customer page
                </a>
              )}
              <StatusBadge status={quote.status} />
            </div>
          </div>
          {!isDraft && (
            <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800">
              {isInvoiceStatus(quote.status)
                ? "This is now an invoice. Editing it will change what the customer sees on their link and PDF."
                : "This quote has already been sent. Editing it will change what the customer sees."}
            </p>
          )}
          <label className="block text-sm">
            <span className="text-gray-700">Customer name *</span>
            <input type="text" required value={quote.customer_name} onChange={(e) => setField("customer_name", e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-gray-700">WhatsApp / phone</span>
              <input type="tel" inputMode="tel" placeholder="e.g. 082 123 4567" value={quote.customer_phone}
                onChange={(e) => setField("customer_phone", e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="text-gray-700">Email</span>
              <input type="email" value={quote.customer_email} onChange={(e) => setField("customer_email", e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Line items</h2>
          {quote.line_items.map((it) => (
            <LineItemEditor key={it.id} item={it} quoteId={id} formatMoney={formatMoney}
              primaryColor={companyConfig.primaryColor}
              onChange={updateItem} onRemove={() => removeItem(it.id)} />
          ))}
          <div className="flex flex-wrap gap-2">
            {MODE_KEYS.map((k) => (
              <button key={k} type="button" onClick={() => addItem(k)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                + {MODES[k].label}
              </button>
            ))}
          </div>
        </section>

        {id ? (
          <ShareButtons
            quote={{ ...quote, id }}
            disabledReason={dirty ? "Save your changes before sending" : null}
            onStatusChange={(row) => setQuote((q) => ({ ...q, status: row.status }))}
          />
        ) : (
          <p className="text-sm text-gray-500">Save the draft to get a shareable link.</p>
        )}

        {id && (
          <section className="rounded-xl bg-white border border-gray-200 p-4 space-y-3">
            <h2 className="font-semibold">Actions</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={downloadPdf} disabled={dirty || exporting}
                title={dirty ? "Save your changes first so the PDF matches what's saved" : undefined}
                className="flex-1 min-w-[7.5rem] rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                {exporting ? "Generating…" : `⬇️ Download ${docLabel(quote.status)} PDF`}
              </button>
              {quote.status === "accepted" && (
                <button type="button" onClick={convertToInvoice} disabled={dirty || converting}
                  title={dirty ? "Save your changes first" : undefined}
                  className="flex-1 min-w-[7.5rem] rounded-lg px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: companyConfig.accentColor }}>
                  {converting ? "Converting…" : "🧾 Convert to Invoice"}
                </button>
              )}
            </div>
            {quote.status === "accepted" && (
              <p className="text-xs text-gray-500">Converting keeps every line item and the total. Only the status changes.</p>
            )}
            {isInvoiceStatus(quote.status) && quote.invoiced_at && (
              <p className="text-xs text-gray-500">Invoiced on {new Date(quote.invoiced_at).toLocaleString("en-ZA")}.</p>
            )}
          </section>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {/* Sticky footer: total + save. Thumb-reachable on phones. */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-gray-500">Total</div>
            <div className="text-xl font-semibold">{formatMoney(total)}</div>
            {savedAt && <div className="text-xs text-gray-400">Saved {savedAt.toLocaleTimeString()}</div>}
          </div>
          <button type="button" onClick={save} disabled={saving}
            className="rounded-lg px-5 py-2.5 text-white font-medium disabled:opacity-60"
            style={{ backgroundColor: companyConfig.primaryColor }}>
            {saving ? "Saving…" : id ? "Save changes" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
