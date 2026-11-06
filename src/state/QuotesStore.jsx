import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { listQuotes } from "../lib/quotesApi";
import { companyConfig } from "../../companyConfig.js";
import { isExpired } from "../lib/quoteMath";

// One live copy of the quote list for the signed-in app (dashboard + the
// nav badge). Hybrid live updates, unchanged from v1:
//  - Supabase Realtime patches rows in place when the table is in the
//    supabase_realtime publication;
//  - a 20s poll while visible + refetch on focus covers dropped sockets.
const POLL_MS = 20000;
const Ctx = createContext(null);
export const useQuotes = () => useContext(Ctx);

export function QuotesProvider({ children }) {
  const [quotes, setQuotes] = useState(null);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const [flashId, setFlashId] = useState(null);

  const load = useCallback(async () => {
    try { setQuotes(await listQuotes(supabase)); setError(null); }
    catch (e) { setError(e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("quotes-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, (payload) => {
        setQuotes((prev) => {
          if (!prev) return prev;
          if (payload.eventType === "DELETE") return prev.filter((q) => q.id !== payload.old.id);
          const row = payload.new;
          const i = prev.findIndex((q) => q.id === row.id);
          return i === -1 ? [row, ...prev] : prev.map((q) => (q.id === row.id ? { ...q, ...row } : q));
        });
        if (payload.eventType !== "DELETE") setFlashId(payload.new.id);
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const t = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, [load]);

  const upsertLocal = useCallback((row) => {
    setQuotes((prev) => {
      if (!prev) return prev;
      const i = prev.findIndex((q) => q.id === row.id);
      return i === -1 ? [row, ...prev] : prev.map((q) => (q.id === row.id ? { ...q, ...row } : q));
    });
  }, []);

  const badges = useMemo(() => ({
    quotes: (quotes ?? []).filter((q) => q.status === "accepted" && !isExpired(q, new Date(), companyConfig.timeZone)).length,
  }), [quotes]);

  const value = useMemo(() => ({ quotes, error, live, reload: load, upsertLocal, badges, flashId }), [quotes, error, live, load, upsertLocal, badges, flashId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
