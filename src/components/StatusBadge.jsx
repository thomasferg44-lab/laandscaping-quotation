// Status pill: the console's semantic pairs exactly, sentence case, always
// the word (never colour alone). "expired" is derived (quoteMath.displayStatus).
const STYLES = {
  draft:    "bg-fill text-ink-2",
  sent:     "bg-info-soft text-info",
  viewed:   "bg-info-soft text-info",
  accepted: "bg-good-soft text-good",
  invoiced: "bg-warn-soft text-warn",
  paid:     "bg-good-soft text-good",
  expired:  "bg-bad-soft text-bad",
};
const LABELS = { draft: "Draft", sent: "Sent", viewed: "Viewed", accepted: "Accepted", invoiced: "Invoiced", paid: "Paid", expired: "Expired" };

export default function StatusBadge({ status, className = "" }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[12px] font-semibold leading-4 whitespace-nowrap ${STYLES[status] ?? STYLES.draft} ${className}`}>
      {LABELS[status] ?? status}
    </span>
  );
}

export function DemoBadge() {
  return <span className="inline-flex items-center rounded-full border border-hairline px-2 py-[2px] text-[11px] font-semibold text-ink-3">Demo</span>;
}
