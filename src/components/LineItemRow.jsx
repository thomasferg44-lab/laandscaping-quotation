import { describeCalc } from "../lib/lineItems";

// Read-only, compact rendering of one saved line item. Reused later on the
// hosted quote page and the dashboard preview.
export default function LineItemRow({ item, formatMoney }) {
  const breakdown = describeCalc(item, formatMoney);
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      {item.photo_url && (
        <img src={item.photo_url} alt="" className="h-14 w-14 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium break-words">{item.description || <span className="text-gray-400">Untitled item</span>}</div>
        {breakdown && <div className="text-xs text-gray-500">{breakdown}</div>}
      </div>
      <div className="font-semibold whitespace-nowrap">{formatMoney(item.total)}</div>
    </div>
  );
}
