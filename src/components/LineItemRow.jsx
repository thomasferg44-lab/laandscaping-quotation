import { describeCalc } from "../lib/lineItems";

// One line of the quote document (public page, quote detail). Description
// left, amount right on a shared baseline; calc + detail in quiet type.
export default function LineItemRow({ item, formatMoney, muted = false, trailing }) {
  const breakdown = describeCalc(item, formatMoney);
  return (
    <div className="flex items-start gap-3 py-3.5 min-h-[56px]">
      {item.photo_url && (
        <a href={item.photo_url} target="_blank" rel="noreferrer" className="flex-shrink-0">
          <img src={item.photo_url} alt={`Photo: ${item.description}`} loading="lazy" className="h-14 w-14 rounded-[12px] object-cover bg-fill" />
        </a>
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-[15px] font-medium break-words ${muted ? "text-ink-3" : "text-ink"}`}>{item.description || "Untitled item"}</div>
        {item.detail && <div className="text-[13px] text-ink-3 break-words">{item.detail}</div>}
        {breakdown && <div className="text-[13px] text-ink-3 tabular">{breakdown}</div>}
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`text-[15px] font-semibold tabular whitespace-nowrap ${muted ? "text-ink-3" : ""}`}>{formatMoney(item.total)}</div>
        {trailing}
      </div>
    </div>
  );
}
