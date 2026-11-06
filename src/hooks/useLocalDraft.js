import { useEffect, useRef } from "react";

// Builder autosave to this device (spec §2A): a closed tab loses nothing.
// Writes the form ~400ms after the last change; cleared on a successful save.
const key = (id) => `quote-draft:${id || "new"}`;

export function readLocalDraft(id) {
  try { const raw = localStorage.getItem(key(id)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearLocalDraft(id) { try { localStorage.removeItem(key(id)); } catch { /* ignore */ } }

export default function useLocalDraft(id, form, dirty) {
  const t = useRef(null);
  useEffect(() => {
    if (!dirty) return;
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      try { localStorage.setItem(key(id), JSON.stringify({ savedAt: new Date().toISOString(), form })); } catch { /* full/blocked */ }
    }, 400);
    return () => clearTimeout(t.current);
  }, [id, form, dirty]);
}
