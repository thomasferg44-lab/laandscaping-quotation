import { useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import { NumberField, Segmented, TextField } from "./ui/Field.jsx";
import { MODES, MODE_KEYS } from "../lib/lineItems";
import { validateLibraryEntry } from "../lib/libraryForm";

// Create / edit one item-library entry. Mounted fresh for every opening
// (callers render it only while open, with a key per entry), so state can
// never carry over from a previous entry.
export default function LibraryEntrySheet(props) {
  if (!props.open || !props.initial) return null;
  return <EntrySheet key={props.initial.id ?? "new"} {...props} />;
}

function EntrySheet({ open, onClose, initial, onSave, title }) {
  const [e, setE] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const errors = validateLibraryEntry(e) ?? {};
  const m = MODES[e.mode] ?? MODES.unit;

  async function submit() {
    setSubmitted(true);
    if (validateLibraryEntry(e)) return;
    setBusy(true); setSaveError(null);
    try { await onSave(e); } catch (err) { setSaveError(err.message || "Couldn't save. Try again."); }
    setBusy(false);
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={<button type="button" onClick={submit} disabled={busy} className="btn-primary w-full">{busy ? "Saving…" : "Save item"}</button>}>
      <div className="space-y-4">
        <TextField label="Name" data-autofocus value={e.name} onChange={(ev) => setE({ ...e, name: ev.target.value })}
          error={submitted ? errors.name : undefined} placeholder="e.g. Instant lawn (Kikuyu)" />
        <TextField label="Description" optional value={e.description ?? ""} onChange={(ev) => setE({ ...e, description: ev.target.value })}
          help="Shown as the detail line on the quote" />
        <div>
          <span className="field-label">Priced</span>
          <Segmented label="Priced" scroll value={e.mode} onChange={(mode) => setE({ ...e, mode })}
            options={MODE_KEYS.map((k) => ({ value: k, label: MODES[k].label }))} />
        </div>
        <NumberField label={`Default ${m.rateLabel.toLowerCase()}`} prefix="R" value={e.rate} placeholder="0,00"
          onChange={(ev) => setE({ ...e, rate: ev.target.value })} error={submitted ? errors.rate : undefined} />
        {saveError && <p className="field-error">{saveError}</p>}
      </div>
    </Sheet>
  );
}
