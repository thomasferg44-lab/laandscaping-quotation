import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import { MODE_KEYS, MODES, lineItemFromLibrary, makeMoneyFormatter, newLineItem } from "../lib/lineItems";
import { addTier, buildQuotePayload, emptyForm, formFromRow, formOptionalCents, formTotalCents, removeTier } from "../lib/quotePayload";
import { getQuote, listLibrary, needsPatch, saveLibraryItem, saveQuote } from "../lib/quotesApi";
import { libraryEntryFromLineItem, toLibraryRow } from "../lib/libraryForm";
import { depositSplit, MAX_TIERS, isAcceptedStatus } from "../lib/quoteMath";
import { docLabel, docRef, isInvoiceStatus } from "../lib/quoteDoc";
import { makeCentsFormatter } from "../lib/money";
import AppShell from "../components/AppShell.jsx";
import LineItemEditor from "../components/LineItemEditor.jsx";
import ShareButtons from "../components/ShareButtons.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import LibraryPicker from "../components/LibraryPicker.jsx";
import LibraryEntrySheet from "../components/LibraryEntrySheet.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import { Field, NumberField, Segmented, Switch, TextField } from "../components/ui/Field.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useQuotes } from "../state/QuotesStore.jsx";
import useLocalDraft, { clearLocalDraft, readLocalDraft } from "../hooks/useLocalDraft";

// Build and edit a quote. One job per screen on phones: this screen builds
// (step 1); sending happens from the share card once saved (step 2); the
// customer accepts on their link (step 3). Drafts autosave to this device.
export default function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const store = useQuotes();
  const formatMoney = useMemo(() => makeMoneyFormatter(companyConfig.currency), []);
  const formatCents = useMemo(() => makeCentsFormatter(companyConfig.currency), []);

  const [form, setForm] = useState(() => emptyForm(companyConfig));
  const [loaded, setLoaded] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [loadError, setLoadError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [activeTier, setActiveTier] = useState(0);
  const [library, setLibrary] = useState(null);
  const [libraryError, setLibraryError] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [libEntry, setLibEntry] = useState(null);
  const [tierToRemove, setTierToRemove] = useState(null);
  const restoredFor = useRef(undefined);

  useLocalDraft(id, form, dirty);

  const restoreDraft = useCallback((base, row) => {
    if (restoredFor.current === (id ?? "new")) return;
    restoredFor.current = id ?? "new";
    const draft = readLocalDraft(id);
    if (!draft?.form) return;
    if (row?.updated_at && draft.savedAt < row.updated_at) { clearLocalDraft(id); return; }
    setForm(draft.form);
    setDirty(true);
    toast("Restored your unsaved changes", {
      duration: 6000,
      action: { label: "Discard", onClick: () => { clearLocalDraft(id); setForm(base); setDirty(false); } },
    });
  }, [id, toast]);

  useEffect(() => {
    let cancelled = false;
    setSubmitted(false);
    setSaveError(null);
    setActiveTier(0);
    if (!id) {
      const base = emptyForm(companyConfig);
      setForm(base); setLoaded(null); setLoading(false);
      restoreDraft(base, null);
      return;
    }
    setLoading(true);
    getQuote(supabase, id)
      .then((row) => {
        if (cancelled) return;
        if (!row) { setLoadError("This quote doesn't exist, or you don't have access to it."); setLoading(false); return; }
        const base = formFromRow(row, companyConfig);
        setLoaded(row); setForm(base); setLoading(false);
        restoreDraft(base, row);
      })
      .catch(() => { if (!cancelled) { setLoadError("Couldn't load this quote. Check your connection and try again."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id, restoreDraft]);

  const ensureLibrary = useCallback(async () => {
    if (library !== null) return;
    try { setLibrary(await listLibrary(supabase)); setLibraryError(null); }
    catch (e) {
      setLibrary([]);
      setLibraryError(needsPatch(e) ? "The item library needs the November database update before it can be used." : "Couldn't load your library. Check your connection.");
    }
  }, [library]);

  // --- editing ------------------------------------------------------------
  const change = (fn) => { setDirty(true); setSaveError(null); setForm(fn); };
  const setField = (k, v) => change((f) => ({ ...f, [k]: v }));
  const items = form.tiered ? form.tiers[activeTier]?.line_items ?? [] : form.line_items;
  const setItems = (fn) => change((f) => {
    if (!f.tiered) return { ...f, line_items: fn(f.line_items) };
    return { ...f, tiers: f.tiers.map((t, i) => (i === activeTier ? { ...t, line_items: fn(t.line_items) } : t)) };
  });
  const addItem = (item) => setItems((list) => [...list, item]);

  function onAddTier() {
    const next = addTier(form);
    change(() => next);
    setActiveTier(next.tiers.length - 1);
    toast(form.tiered ? "Option added. Its items start as a copy" : "Options on. Adjust what each one includes");
  }
  function confirmRemoveTier() {
    change((f) => removeTier(f, tierToRemove));
    setActiveTier(0);
    setTierToRemove(null);
  }

  const known = useMemo(() => ({
    tiers: loaded ? "tiers" in loaded : false,
    deposit_type: loaded ? "deposit_type" in loaded : false,
    deposit_value: loaded ? "deposit_value" in loaded : false,
    valid_until: loaded ? "valid_until" in loaded : false,
    valid_until_original: loaded?.valid_until ? String(loaded.valid_until).slice(0, 10) : null,
  }), [loaded]);
  const check = useMemo(() => buildQuotePayload(form, { known, timeZone: companyConfig.timeZone }), [form, known]);
  const errors = submitted ? check.errors ?? {} : {};

  async function save(e) {
    e?.preventDefault();
    setSubmitted(true);
    setSaveError(null);
    if (check.errors) {
      // first invalid tier with item errors, so the error is on screen
      const bad = check.errors.itemErrors && form.tiered
        ? form.tiers.findIndex((t) => t.line_items.some((it) => check.errors.itemErrors[it.id]))
        : -1;
      if (bad >= 0) setActiveTier(bad);
      setTimeout(() => document.querySelector('[aria-invalid="true"], [data-error="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return;
    }
    setSaving(true);
    try {
      const row = await saveQuote(supabase, id, check.payload);
      clearLocalDraft(id);
      if (!id) clearLocalDraft(null);
      setLoaded(row);
      setForm(formFromRow(row, companyConfig));
      setDirty(false);
      setSubmitted(false);
      setSavedAt(new Date());
      store?.upsertLocal(row);
      toast(id ? "Changes saved" : "Draft saved");
      if (!id) navigate(`/builder/${row.id}`, { replace: true });
    } catch (err) {
      setSaveError(needsPatch(err)
        ? "Options, deposits and valid-until dates need the November database update. Switch them off to save now; your work is kept on this device."
        : "Couldn't save. Check your connection and try again. Your changes are kept on this device.");
    }
    setSaving(false);
  }

  async function saveToLibrary(entry) {
    const row = await saveLibraryItem(supabase, toLibraryRow(entry));
    setLibrary((l) => [...(l ?? []), row].sort((a, b) => a.name.localeCompare(b.name)));
    setLibEntry(null);
    toast("Saved to your item library");
  }
  async function openSaveToLibrary(item) {
    await ensureLibrary();
    setLibEntry(libraryEntryFromLineItem(item));
  }

  // --- render -------------------------------------------------------------
  const quote = loaded ? { ...loaded, ...form, id } : form;
  const isDraft = (loaded?.status ?? "draft") === "draft";
  const locked = Boolean(loaded?.accepted_selection) && isAcceptedStatus(loaded.status);
  const title = id ? `Edit ${docLabel(loaded?.status ?? "draft").toLowerCase()}` : "New quote";
  const totalCents = formTotalCents(form);
  const optionalCents = formOptionalCents(form, activeTier);
  const dep = form.depositOn ? depositSplit(totalCents, { type: form.deposit.type, value: form.deposit.value }) : null;
  const step = !id || isDraft ? 1 : isAcceptedStatus(loaded.status) ? 3 : 2;

  if (loading) {
    return (
      <AppShell title={title} back={{ to: "/", label: "Quotes" }} hideTabs>
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-6 w-40" /><Skeleton className="h-48" /><Skeleton className="h-72" />
        </div>
      </AppShell>
    );
  }
  if (loadError) {
    return (
      <AppShell title="Quote" back={{ to: "/", label: "Quotes" }}>
        <div className="card p-6 text-center">
          <p className="text-[15px] text-ink-2">{loadError}</p>
          <Link to="/" className="btn-secondary mt-4">Back to quotes</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={title} back={{ to: id ? `/quotes/${id}` : "/", label: id ? "Quote" : "Quotes" }} hideTabs
      actions={loaded && <StatusBadge status={loaded.status} />}>
      <form onSubmit={save} className="space-y-5" noValidate>
        <StepDots step={step} />

        {locked ? (
          <div className="card p-5 bg-good-soft/60 space-y-2">
            <div className="flex items-center gap-2 text-good font-semibold"><Icon name="check" /> Accepted by the customer</div>
            <p className="text-[15px] text-ink-2">
              Accepted quotes are locked, so the {isInvoiceStatus(loaded.status) ? "invoice" : "quote"} always matches exactly what the customer agreed to.
            </p>
            <Link to={`/quotes/${id}`} className="btn-secondary">View quote details</Link>
          </div>
        ) : !isDraft && loaded ? (
          <p className="card px-4 py-3 text-[14px] bg-warn-soft text-warn">
            {isInvoiceStatus(loaded.status)
              ? "This is now an invoice. Editing it will change what the customer sees on their link and PDF."
              : "This quote has already been sent. Editing it will change what the customer sees."}
          </p>
        ) : null}

        <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">
          {/* Customer */}
          <section className="card p-5 space-y-4" aria-labelledby="cust-h">
            <h2 id="cust-h" className="text-[17px] font-semibold">Customer</h2>
            <TextField label="Customer name" value={form.customer_name} autoComplete="off"
              onChange={(e) => setField("customer_name", e.target.value)} error={errors.customer_name} placeholder="e.g. Test Customer" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextField label="WhatsApp number" optional type="tel" inputMode="tel" value={form.customer_phone}
                onChange={(e) => setField("customer_phone", e.target.value)} placeholder="e.g. 082 000 0000"
                help="Used for the WhatsApp send and follow-up" />
              <TextField label="Email" optional type="email" inputMode="email" value={form.customer_email}
                onChange={(e) => setField("customer_email", e.target.value)} error={errors.customer_email} placeholder="e.g. test@example.com" />
            </div>
          </section>

          {/* Options (tiers) */}
          <section className="card p-5 space-y-4" aria-labelledby="opt-h">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="opt-h" className="text-[17px] font-semibold">{form.tiered ? "Options" : "Line items"}</h2>
                <p className="text-[13px] text-ink-3">
                  {form.tiered ? "The customer picks one option before accepting." : "Offer Good, Better and Best options to give the customer a choice."}
                </p>
              </div>
              {(!form.tiered || form.tiers.length < MAX_TIERS) && (
                <button type="button" onClick={onAddTier} className="btn-secondary flex-shrink-0">
                  <Icon name="layers" size={18} /> {form.tiered ? "Add option" : "Offer options"}
                </button>
              )}
            </div>
            {form.tiered && (
              <>
                <Segmented label="Option to edit" value={String(activeTier)} onChange={(v) => setActiveTier(Number(v))}
                  options={form.tiers.map((t, i) => ({ value: String(i), label: t.name?.trim() || `Option ${i + 1}` }))} />
                <div className="flex items-end gap-3" data-error={errors.tierErrors?.[form.tiers[activeTier].id] ? "true" : undefined}>
                  <TextField className="flex-1" label="Option name" value={form.tiers[activeTier].name}
                    onChange={(e) => change((f) => ({ ...f, tiers: f.tiers.map((t, i) => (i === activeTier ? { ...t, name: e.target.value } : t)) }))}
                    error={errors.tierErrors?.[form.tiers[activeTier].id]} />
                  <button type="button" onClick={() => setTierToRemove(form.tiers[activeTier].id)}
                    className="btn bg-transparent text-bad hover:bg-bad-soft mb-[2px]" aria-label="Remove this option">
                    <Icon name="trash" size={18} />
                  </button>
                </div>
                {Object.keys(errors.tierErrors ?? {}).length > 0 && (
                  <p className="field-error"><Icon name="alert" size={15} className="mt-[1px]" />
                    Fix the options marked: {form.tiers.filter((t) => errors.tierErrors[t.id]).map((t) => t.name || "unnamed").join(", ")}
                  </p>
                )}
              </>
            )}
          </section>

          {/* Items */}
          <section className="space-y-3" aria-label="Items">
            {items.map((it, i) => (
              <LineItemEditor key={it.id} item={it} index={i} quoteId={id} formatMoney={formatMoney} submitted={submitted}
                canRemove={items.length > 1 || Boolean(it.description)}
                onChange={(next) => setItems((list) => list.map((x) => (x.id === next.id ? next : x)))}
                onRemove={() => setItems((list) => {
                  const rest = list.filter((x) => x.id !== it.id);
                  return rest.length ? rest : [newLineItem("area")];
                })}
                onSaveToLibrary={openSaveToLibrary} />
            ))}
            {errors.items && <p className="field-error" data-error="true"><Icon name="alert" size={15} className="mt-[1px]" />{errors.items}</p>}

            <div className="card p-4 space-y-3">
              <button type="button" onClick={() => { ensureLibrary(); setPickerOpen(true); }} className="btn-secondary w-full py-3">
                <Icon name="book" size={18} /> Add from library
              </button>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {MODE_KEYS.map((k) => (
                  <button key={k} type="button" onClick={() => addItem(newLineItem(k))} className="btn bg-white border border-hairline text-ink hover:bg-fill text-[14px] px-2">
                    <Icon name="plus" size={16} /> {MODES[k].label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Terms */}
          <section className="card p-5 space-y-4" aria-labelledby="terms-h">
            <h2 id="terms-h" className="text-[17px] font-semibold">Terms</h2>
            <Field label="Valid until" optional error={errors.valid_until}
              help={form.valid_until ? "The customer can't accept after this date." : "No expiry date: the quote stays open."}>
              {(a) => (
                <div className="flex gap-2">
                  <input {...a} type="date" value={form.valid_until} onChange={(e) => setField("valid_until", e.target.value)} className="input flex-1" />
                  {form.valid_until && <button type="button" onClick={() => setField("valid_until", "")} className="btn-secondary">Clear</button>}
                </div>
              )}
            </Field>
            <div className="border-t border-hairline pt-2">
              <Switch id="deposit-on" checked={form.depositOn} onChange={(v) => setField("depositOn", v)}
                label="Ask for a deposit" description="Shown on the quote as due on acceptance, with the balance on completion." />
            </div>
            {form.depositOn && (
              <div className="space-y-3 animate-rise" data-error={errors.deposit ? "true" : undefined}>
                <Segmented label="Deposit type" value={form.deposit.type} onChange={(type) => setField("deposit", { ...form.deposit, type })}
                  options={[{ value: "percent", label: "Percentage" }, { value: "fixed", label: "Fixed amount" }]} />
                <NumberField label={form.deposit.type === "percent" ? "Deposit percentage" : "Deposit amount"}
                  prefix={form.deposit.type === "fixed" ? "R" : undefined} suffix={form.deposit.type === "percent" ? "%" : undefined}
                  value={form.deposit.value} onChange={(e) => setField("deposit", { ...form.deposit, value: e.target.value })}
                  error={errors.deposit}
                  help={dep && totalCents > 0 ? `${formatCents(dep.depositCents)} now, ${formatCents(dep.balanceCents)} on completion${form.tiered ? " (cheapest option)" : ""}` : undefined} />
              </div>
            )}
          </section>
        </fieldset>

        {id && !locked && (
          <ShareButtons quote={{ ...quote, status: loaded.status }} disabledReason={dirty ? "Save your changes before sending" : null}
            onStatusChange={(row) => { setLoaded((l) => ({ ...l, ...row })); store?.upsertLocal(row); }} />
        )}
        {id && (
          <Link to={`/quotes/${id}`} className="btn-plain w-full">View quote details and history <Icon name="chevronRight" size={18} /></Link>
        )}
        {!id && <p className="text-[13px] text-ink-3 text-center">Save the draft to get a link you can send.</p>}
      </form>

      {/* Sticky frosted total bar: thumb zone, total updates live */}
      {!locked && (
        <div className="fixed bottom-0 inset-x-0 lg:left-[248px] z-30 glass-white border-t border-hairline pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-ink-3">{form.tiered ? "From" : "Total"}{loaded ? ` · ${docRef({ ...loaded })}` : ""}</div>
              <div className="text-[26px] leading-tight font-semibold tabular" data-testid="sticky-total">{formatCents(totalCents)}</div>
              <div className="text-[12px] text-ink-3 truncate" aria-live="polite">
                {saveError ? <span className="text-error">Not saved</span>
                  : dirty ? "Unsaved changes, kept on this device"
                  : savedAt ? `Saved ${savedAt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`
                  : optionalCents > 0 ? `+ ${formatCents(optionalCents)} in optional add-ons` : id ? "All changes saved" : "Not saved yet"}
              </div>
            </div>
            <button type="button" onClick={save} disabled={saving} className="btn-primary flex-1 sm:flex-none sm:min-w-[180px] text-[17px]">
              {saving ? "Saving…" : id ? "Save changes" : "Save draft"}
            </button>
          </div>
          {saveError && <p className="max-w-3xl mx-auto px-4 sm:px-6 pb-3 -mt-1 field-error" role="alert"><Icon name="alert" size={15} className="mt-[1px]" />{saveError}</p>}
        </div>
      )}

      <LibraryPicker open={pickerOpen} onClose={() => setPickerOpen(false)} items={library} error={libraryError} formatMoney={formatMoney}
        onPick={(entry) => { addItem(lineItemFromLibrary(entry)); setPickerOpen(false); toast(`Added ${entry.name}`); }} />
      <LibraryEntrySheet open={Boolean(libEntry)} initial={libEntry} title="Save to library" onClose={() => setLibEntry(null)}
        onSave={(e) => {
          if (libraryError) throw new Error(libraryError);
          return saveToLibrary(e);
        }} />
      <ConfirmSheet open={Boolean(tierToRemove)} onClose={() => setTierToRemove(null)} title="Remove this option?" danger
        confirmLabel="Remove option" onConfirm={confirmRemoveTier}
        body={<p>Its items are removed from the quote. {form.tiers.length <= 2 ? "With one option left, this becomes a normal single-price quote." : ""}</p>} />
    </AppShell>
  );
}

function StepDots({ step }) {
  const steps = ["Build", "Send", "Accept"];
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-3" aria-label={`Step ${step} of 3: ${steps[step - 1]}`}>
      <span className="flex gap-1.5" aria-hidden>
        {steps.map((s, i) => <span key={s} className={`h-1.5 rounded-full transition-all duration-200 ${i + 1 === step ? "w-5 bg-brand" : i + 1 < step ? "w-1.5 bg-brand/50" : "w-1.5 bg-fill-2"}`} />)}
      </span>
      Step {step} of 3 · {steps[step - 1]}
    </div>
  );
}
