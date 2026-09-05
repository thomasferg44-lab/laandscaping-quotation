// Shared status pill. Used on the public page now; the dashboard reuses it later.
const STYLES = {
  draft:    "bg-gray-100 text-gray-600",
  sent:     "bg-blue-50 text-blue-700",
  viewed:   "bg-indigo-50 text-indigo-700",
  accepted: "bg-green-50 text-green-700",
  invoiced: "bg-amber-50 text-amber-700",
  paid:     "bg-emerald-100 text-emerald-800",
};

export default function StatusBadge({ status }) {
  return (
    <span className={`text-xs uppercase tracking-wide rounded-full px-2 py-0.5 ${STYLES[status] ?? STYLES.draft}`}>
      {status}
    </span>
  );
}
