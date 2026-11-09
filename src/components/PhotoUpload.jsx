import { useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import Icon from "./ui/Icon.jsx";

const BUCKET = "quote-photos";

// One optional photo per line item. Uploads straight to Supabase Storage
// (authenticated landscaper only, per RLS) and hands back the public URL.
export default function PhotoUpload({ value, onChange, quoteId }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${quoteId || "unsaved"}/${crypto.randomUUID()}.${ext}`;
    try {
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || undefined,
      });
      if (upErr) setError("The photo didn't upload. Check your connection and try again.");
      else onChange(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    } catch {
      setError("The photo didn't upload. Check your connection and try again.");
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <>
          <a href={value} target="_blank" rel="noreferrer">
            <img src={value} alt="Line item photo" className="h-14 w-14 rounded-[12px] object-cover bg-fill" />
          </a>
          <button type="button" onClick={() => onChange(null)} className="btn bg-transparent text-bad px-2 hover:bg-bad-soft">Remove photo</button>
        </>
      ) : (
        <label className={`btn-secondary cursor-pointer ${busy ? "opacity-60" : ""}`}>
          <Icon name="camera" size={18} />
          <span>{busy ? "Uploading…" : "Add photo"}</span>
          {/* capture="environment" opens the rear camera on phones */}
          <input ref={inputRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} disabled={busy} />
        </label>
      )}
      {error && <span className="text-[13px] text-error">{error}</span>}
    </div>
  );
}
