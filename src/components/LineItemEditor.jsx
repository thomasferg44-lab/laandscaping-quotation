import { useState } from "react";
import { MODES, MODE_KEYS, computeTotal, describeCalc, stepQty, validateLineItem } from "../lib/lineItems";
import { applySuggestion } from "../lib/suggestions";
import PhotoUpload from "./PhotoUpload.jsx";
import Icon from "./ui/Icon.jsx";
import { NumberField, Segmented, StepperField, Switch, TextField } from "./ui/Field.jsx";

// Edits one line item. The mode picker is a calculator UI: whichever mode is
// chosen, the result is still { description, qty, rate, total }.
// Errors show after the field is left or after a save attempt (spec §2).
export default function LineItemEditor({ item, index, onChange, onRemove, quoteId, formatMoney, submitted, onSaveToLibrary, canRemove = true, suggest }) {
  const m = MODES[item.mode];
  const [touched, setTouched] = useState({});
  const [showDetail, setShowDetail] = useState(Boolean(item.detail));
  const [typing, setTyping] = useState(false);
  // As-you-type matches from the library and past quotes (deterministic).
  const matches = typing && suggest && item.description.trim().length >= 2 ? suggest(item.description) : [];
  const errors = validateLineItem(item);
  const err = (f) => ((touched[f] || submitted) ? errors[f] : undefined);
  const touch = (f) => () => setTouched((t) => ({ ...t, [f]: true }));

  function set(patch) {
    const next = { ...item, ...patch };
    next.total = computeTotal(next);
    onChange(next);
  }
  function setMode(mode) {
    set({ mode, qty: mode === "plain" ? 1 : item.mode === "plain" ? "" : item.qty });
  }

  const breakdown = describeCalc(item, formatMoney);
  const n = index + 1;

  return (
    <div className="card p-4 sm:p-5 space-y-4 animate-rise" data-testid="line-item">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink-3">Item {n}</span>
        {item.optional && <span className="rounded-full bg-info-soft text-info text-[12px] font-semibold px-2.5 py-[3px]">Optional add-on</span>}
      </div>

      <Segmented label={`How item ${n} is priced`} scroll value={item.mode} onChange={setMode}
        options={MODE_KEYS.map((k) => ({ value: k, label: MODES[k].label }))} />

      <div>
        <TextField label="Description" value={item.description} autoComplete="off"
          onChange={(e) => { set({ description: e.target.value }); setTyping(true); }}
          onBlur={() => { touch("description")(); setTimeout(() => setTyping(false), 150); }}
          error={err("description")} placeholder={placeholderFor(item.mode)} />
        {matches.length > 0 && (
          <ul className="mt-2 rounded-input border border-hairline bg-white shadow-card overflow-hidden divide-y divide-hairline" aria-label="Matching items">
            {matches.map((s) => (
              <li key={s.key}>
                <button type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(applySuggestion(item, s)); setTyping(false); if (s.detail) setShowDetail(true); }}
                  className="w-full flex items-center gap-3 px-3.5 min-h-[48px] text-left hover:bg-fill active:bg-fill-2">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] truncate">{s.name}</span>
                    <span className="block text-[12px] text-ink-3 truncate">{MODES[s.mode].label} · {s.source === "history" ? `used in ${s.uses} quote${s.uses === 1 ? "" : "s"}` : s.uses ? `library · used ${s.uses}×` : "library"}</span>
                  </span>
                  <span className="text-[14px] font-semibold tabular whitespace-nowrap">{formatMoney(s.rate)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showDetail ? (
        <TextField label="Detail" optional value={item.detail ?? ""} onChange={(e) => set({ detail: e.target.value })}
          help="A quiet second line on the quote, e.g. Supplied and laid on prepared soil" />
      ) : (
        <button type="button" onClick={() => setShowDetail(true)} className="btn-plain -ml-3 -my-2 text-[15px]">
          <Icon name="plus" size={18} /> Add detail line
        </button>
      )}

      <div className={`grid gap-3 ${m.qtyLabel ? "grid-cols-2" : "grid-cols-1"}`}>
        {m.qtyLabel && (
          <StepperField label={m.qtyLabel} value={item.qty} unit={item.mode === "area" ? "m²" : undefined}
            onChange={(v) => set({ qty: v })} onStep={(d) => { set({ qty: stepQty(item.qty, d) }); touch("qty")(); }}
            onBlur={touch("qty")} error={err("qty")} />
        )}
        <NumberField label={m.rateLabel} prefix="R" value={item.rate} placeholder="0,00"
          onChange={(e) => set({ rate: e.target.value })} onBlur={touch("rate")} error={err("rate")} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PhotoUpload value={item.photo_url} quoteId={quoteId} onChange={(url) => set({ photo_url: url })} />
        <div className="text-right ml-auto">
          {breakdown && <div className="text-[13px] text-ink-3 tabular">{breakdown}</div>}
          <div className="text-[19px] font-semibold tabular" data-testid="line-total">{formatMoney(item.total)}</div>
        </div>
      </div>

      <div className="border-t border-hairline pt-1">
        <Switch id={`opt-${item.id}`} checked={Boolean(item.optional)} onChange={(v) => set({ optional: v })}
          label="Optional add-on" description="The customer can tick it on or off. Not in the total unless they do." />
      </div>

      <div className="flex items-center justify-between -mb-2 -mx-2">
        {canRemove ? (
          <button type="button" onClick={onRemove} className="btn bg-transparent text-bad px-2 hover:bg-bad-soft">
            <Icon name="trash" size={18} /> Remove
          </button>
        ) : <span />}
        {onSaveToLibrary && (
          <button type="button" onClick={() => onSaveToLibrary(item)} className="btn-plain">
            <Icon name="book" size={18} /> Save to library
          </button>
        )}
      </div>
    </div>
  );
}

function placeholderFor(mode) {
  return {
    plain: "e.g. Call-out fee",
    area: "e.g. Lay instant lawn (Kikuyu)",
    unit: "e.g. Agapanthus, 4 L bags",
    load: "e.g. Compost delivered",
    day: "e.g. Labour, 2-person team",
  }[mode];
}
