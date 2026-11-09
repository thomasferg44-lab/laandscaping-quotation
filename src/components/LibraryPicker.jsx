import { useMemo, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { MODES } from "../lib/lineItems";
import { Link } from "react-router-dom";

// One-tap insert from the item library into the builder.
export default function LibraryPicker({ open, onClose, items, error, onPick, formatMoney }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => (items ?? []).filter((i) => !q.trim() || `${i.name} ${i.description ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);
  return (
    <Sheet open={open} onClose={onClose} title="Add from library">
      <div className="relative mb-3">
        <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" aria-label="Search items"
          className="w-full rounded-input bg-fill-2 pl-10 pr-3 min-h-[44px] text-base outline-none focus:shadow-ring" />
      </div>
      {error ? (
        <p className="text-[15px] text-ink-2 py-6 text-center">{error}</p>
      ) : items === null ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : shown.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[15px] text-ink-2">{items.length ? "No items match." : "Your library is empty."}</p>
          <Link to="/library" className="btn-plain mt-2">Manage library</Link>
        </div>
      ) : (
        <ul className="divide-y divide-hairline -mx-1">
          {shown.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => onPick(i)} className="w-full flex items-center gap-3 px-1 py-3 min-h-[56px] text-left rounded-input hover:bg-fill active:bg-fill-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium truncate">{i.name}</div>
                  <div className="text-[13px] text-ink-3 truncate">{MODES[i.mode]?.label ?? "Per unit"}{i.description ? ` · ${i.description}` : ""}</div>
                </div>
                <div className="text-[15px] font-semibold tabular whitespace-nowrap">{formatMoney(i.default_rate)}</div>
                <Icon name="plus" className="text-action" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
