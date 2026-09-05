import { useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

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
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (upErr) {
      setError(upErr.message);
    } else {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <>
          <a href={value} target="_blank" rel="noreferrer">
            <img src={value} alt="Line item photo" className="h-16 w-16 rounded-lg object-cover border border-gray-200" />
          </a>
          <button type="button" onClick={() => onChange(null)} className="text-sm text-red-600 underline">
            Remove photo
          </button>
        </>
      ) : (
        <label className="text-sm text-gray-700 cursor-pointer inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 hover:bg-gray-50">
          <span>{busy ? "Uploading…" : "📷 Add photo"}</span>
          {/* capture="environment" opens the rear camera on phones */}
          <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} disabled={busy} />
        </label>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
