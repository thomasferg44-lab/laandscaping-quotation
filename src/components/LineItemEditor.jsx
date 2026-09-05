import { MODES, MODE_KEYS, computeTotal, describeCalc } from "../lib/lineItems";
import PhotoUpload from "./PhotoUpload.jsx";

// Edits one line item. The mode picker is a calculator UI: whichever mode is
// chosen, the result is still { description, qty, rate, total }.
export default function LineItemEditor({ item, onChange, onRemove, quoteId, formatMoney, primaryColor }) {
  const m = MODES[item.mode];

  function set(patch) {
    const next = { ...item, ...patch };
    next.total = computeTotal(next);
    onChange(next);
  }

  function setMode(mode) {
    set({ mode, qty: mode === "plain" ? 1 : item.mode === "plain" ? "" : item.qty });
  }

  const breakdown = describeCalc(item, formatMoney);

  return (
    <div className="rounded-xl bg-white border border-gray-200 p-4 space-y-3">
      {/* Mode picker: horizontally scrollable pills for phone screens */}
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        {MODE_KEYS.map((k) => {
          const active = k === item.mode;
          return (
            <button key={k} type="button" onClick={() => setMode(k)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-sm border ${active ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
              style={active ? { backgroundColor: primaryColor } : undefined}>
              {MODES[k].label}
            </button>
          );
        })}
      </div>

      <label className="block text-sm">
        <span className="text-gray-700">Description</span>
        <input type="text" value={item.description} onChange={(e) => set({ description: e.target.value })}
          placeholder={placeholderFor(item.mode)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        {m.qtyLabel && (
          <label className="block text-sm">
            <span className="text-gray-700">{m.qtyLabel}</span>
            <input type="number" inputMode="decimal" min="0" step="any" value={item.qty}
              onChange={(e) => set({ qty: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
        )}
        <label className={`block text-sm ${m.qtyLabel ? "" : "col-span-2"}`}>
          <span className="text-gray-700">{m.rateLabel}</span>
          <input type="number" inputMode="decimal" min="0" step="any" value={item.rate}
            onChange={(e) => set({ rate: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
        </label>
      </div>

      <PhotoUpload value={item.photo_url} quoteId={quoteId} onChange={(url) => set({ photo_url: url })} />

      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={onRemove} className="text-sm text-red-600">Remove</button>
        <div className="text-right">
          {breakdown && <div className="text-xs text-gray-500">{breakdown}</div>}
          <div className="font-semibold">{formatMoney(item.total)}</div>
        </div>
      </div>
    </div>
  );
}

function placeholderFor(mode) {
  return {
    plain: "e.g. Call-out fee",
    area: "e.g. Lay instant lawn (Kikuyu)",
    unit: "e.g. Agapanthus, 20cm bags",
    load: "e.g. Compost delivered",
    day: "e.g. Labour, 2-person team",
  }[mode];
}
