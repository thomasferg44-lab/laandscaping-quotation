import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { loadDemoData, removeDemoData } from "../lib/demoData";
import { needsPatch } from "../lib/quotesApi";
import { useToast } from "../components/ui/Toast.jsx";
import { useQuotes } from "../state/QuotesStore.jsx";

// Load / remove demo data as the signed-in user (RLS is the guard).
export default function useDemoData() {
  const toast = useToast();
  const store = useQuotes();
  const [busy, setBusy] = useState(null); // "load" | "remove" | null
  const [error, setError] = useState(null);

  const owner = async () => (await supabase.auth.getSession()).data.session?.user?.id;
  const explain = (e) => (needsPatch(e)
    ? "Demo data needs the November database update first."
    : "That didn't work. Check your connection and try again.");

  async function load() {
    setBusy("load"); setError(null);
    try {
      const r = await loadDemoData(supabase, await owner());
      await store?.reload();
      toast(r.skipped ? "Demo data is already loaded" : `Loaded ${r.quotes} demo quotes and ${r.library} library items`);
    } catch (e) { setError(explain(e)); }
    setBusy(null);
  }
  async function remove() {
    setBusy("remove"); setError(null);
    try {
      const r = await removeDemoData(supabase, await owner());
      await store?.reload();
      toast(`Removed ${r.quotes} demo quotes and ${r.library} library items`);
      return true;
    } catch (e) { setError(explain(e)); return false; }
    finally { setBusy(null); }
  }
  return { load, remove, busy, error };
}
