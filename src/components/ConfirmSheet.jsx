import Sheet from "./ui/Sheet.jsx";

// Destructive/irreversible confirmations (spec §4): a real sheet that says
// the consequence in plain words. Never window.confirm().
export default function ConfirmSheet({ open, onClose, title, body, confirmLabel, onConfirm, busy, danger = false, error }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3.5">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} data-autofocus
            className={`flex-1 py-3.5 ${danger ? "btn bg-bad text-white" : "btn-primary"}`}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      }>
      <div className="text-[15px] text-ink-2 space-y-2">{body}</div>
      {error && <p className="field-error">{error}</p>}
    </Sheet>
  );
}
