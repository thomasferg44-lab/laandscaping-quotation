import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import { deleteLibraryItem, listLibrary, needsPatch, saveLibraryItem } from "../lib/quotesApi";
import { toLibraryRow } from "../lib/libraryForm";
import { MODES, makeMoneyFormatter } from "../lib/lineItems";
import AppShell from "../components/AppShell.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LibraryEntrySheet from "../components/LibraryEntrySheet.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import { DemoBadge } from "../components/StatusBadge.jsx";
import Icon from "../components/ui/Icon.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useQuotes } from "../state/QuotesStore.jsx";
import useDemoData from "../hooks/useDemoData";

const BLANK = { name: "", description: "", mode: "area", rate: "" };

// Item library (pricebook-lite): saved items with a default rate, one tap to
// insert into a quote.
export default function Library() {
  const toast = useToast();
  const store = useQuotes();
  const demo = useDemoData();
  const money = useMemo(() => makeMoneyFormatter(companyConfig.currency), []);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  async function load() {
    try { setItems(await listLibrary(supabase)); setError(null); }
    catch (e) { setItems([]); setError(needsPatch(e) ? "patch" : "network"); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (store?.quotes) load(); }, [store?.quotes?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e) {
    const row = await saveLibraryItem(supabase, toLibraryRow(e));
    setItems((list) => {
      const rest = (list ?? []).filter((x) => x.id !== row.id);
      return [...rest, row].sort((a, b) => a.name.localeCompare(b.name));
    });
    setEditing(null);
    toast(e.id ? "Item updated" : "Item added to your library");
  }
  async function remove() {
    setBusy(true);
    try {
      await deleteLibraryItem(supabase, deleting.id);
      setItems((list) => list.filter((x) => x.id !== deleting.id));
      toast("Item deleted");
      setDeleting(null);
    } catch { toast("Couldn't delete. Try again"); }
    setBusy(false);
  }

  const shown = (items ?? []).filter((i) => !q.trim() || `${i.name} ${i.description ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <AppShell title="Item library" badges={store?.badges}
      actions={items?.length > 0 && !error && (
        <button type="button" onClick={() => setEditing(BLANK)} className="btn-plain"><Icon name="plus" size={18} /> Add</button>
      )}>
      {items === null ? (
        <div className="card divide-y divide-hairline">{[0, 1, 2, 3].map((i) => <div key={i} className="p-4"><Skeleton className="h-10" /></div>)}</div>
      ) : error === "patch" ? (
        <EmptyState icon="book" title="Item library is almost ready"
          body="It needs the November database update, which DropStack applies. Your quotes work as normal in the meantime." />
      ) : error ? (
        <div className="card p-6 text-center space-y-3" role="alert">
          <p className="text-[15px] text-ink-2">Couldn't load your library. Check your connection.</p>
          <button type="button" onClick={load} className="btn-secondary"><Icon name="refresh" size={18} /> Try again</button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="book" title="Save the items you quote often"
          body="Add each item once with its usual rate, then insert it into any quote with one tap."
          action={<button type="button" onClick={() => setEditing(BLANK)} className="btn-primary px-6"><Icon name="plus" size={18} /> Add an item</button>}
          secondary={<button type="button" onClick={demo.load} disabled={Boolean(demo.busy)} className="btn-secondary px-6 py-3.5">{demo.busy ? "Loading…" : "Load demo data"}</button>} />
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" aria-label="Search items"
              className="w-full rounded-input bg-fill-2 pl-10 pr-3 min-h-[44px] text-base outline-none focus:shadow-ring" />
          </div>
          <ul className="card divide-y divide-hairline overflow-hidden" aria-label="Library items">
            {shown.map((i) => (
              <li key={i.id} className="flex items-center">
                <button type="button" onClick={() => setEditing({ id: i.id, name: i.name, description: i.description ?? "", mode: i.mode, rate: String(i.default_rate) })}
                  className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 min-h-[64px] text-left hover:bg-fill/60">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="text-[15px] font-semibold truncate">{i.name}</span>{i.is_demo && <DemoBadge />}</div>
                    <div className="text-[13px] text-ink-3 truncate">{MODES[i.mode]?.label ?? "Per unit"}{i.description ? ` · ${i.description}` : ""}</div>
                  </div>
                  <div className="text-[15px] font-semibold tabular whitespace-nowrap">{money(i.default_rate)}</div>
                </button>
                <button type="button" onClick={() => setDeleting(i)} aria-label={`Delete ${i.name}`}
                  className="w-12 self-stretch flex items-center justify-center text-ink-3 hover:text-bad hover:bg-bad-soft border-l border-hairline">
                  <Icon name="trash" size={18} />
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="text-center text-[15px] text-ink-3">No items match.</p>}
        </div>
      )}
      {demo.error && <p className="mt-4 field-error justify-center">{demo.error}</p>}

      <LibraryEntrySheet open={Boolean(editing)} initial={editing} title={editing?.id ? "Edit item" : "New item"} onClose={() => setEditing(null)} onSave={save} />
      <ConfirmSheet open={Boolean(deleting)} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? "item"}?`} danger
        confirmLabel="Delete item" onConfirm={remove} busy={busy}
        body={<p>It's removed from your library. Quotes that already use it keep their items and prices.</p>} />
    </AppShell>
  );
}
