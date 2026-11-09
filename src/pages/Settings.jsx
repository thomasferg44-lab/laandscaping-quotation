import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { companyConfig } from "../../companyConfig";
import { normaliseWhatsAppNumber } from "../lib/shareLinks";
import AppShell from "../components/AppShell.jsx";
import BrandMark from "../components/ui/BrandMark.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import Icon from "../components/ui/Icon.jsx";
import { useQuotes } from "../state/QuotesStore.jsx";
import useDemoData from "../hooks/useDemoData";

// Settings: what this deploy is configured with (read-only: it lives in
// companyConfig.js, set by DropStack), demo data, sign out.
export default function Settings() {
  const store = useQuotes();
  const demo = useDemoData();
  const [user, setUser] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null)); }, []);
  const email = user?.email;
  // Only this login's demo rows: a staff login can see other owners' rows.
  const demoCount = (store?.quotes ?? []).filter((q) => q.is_demo && q.owner_id === user?.id).length;
  const dep = companyConfig.depositDefault;
  const wa = normaliseWhatsAppNumber(companyConfig.whatsappNumber);

  return (
    <AppShell title="Settings" badges={store?.badges}>
      <div className="space-y-5">
        <section className="card p-5 space-y-4" aria-labelledby="biz-h">
          <div className="flex items-center gap-3">
            <BrandMark size={48} className="rounded-[14px]" />
            <div className="min-w-0">
              <h2 id="biz-h" className="text-[17px] font-semibold truncate">{companyConfig.businessName}</h2>
              <p className="text-[13px] text-ink-3">Branding and defaults are set up by DropStack for your business.</p>
            </div>
          </div>
          <dl className="divide-y divide-hairline text-[15px]">
            <Row label="Quote email" value={companyConfig.contactEmail || "Not set"} />
            <Row label="WhatsApp" value={wa ? `+${wa}` : "Not set"} />
            <Row label="Default deposit" value={dep ? (dep.type === "percent" ? `${dep.value}%` : `R ${dep.value}`) : "None"} />
            <Row label="Quotes valid for" value={companyConfig.quoteValidityDays > 0 ? `${companyConfig.quoteValidityDays} days` : "No expiry"} />
            <Row label="Payment instructions" value={companyConfig.paymentInstructions || "Not set"} />
          </dl>
        </section>

        <section className="card p-5 space-y-3 aura-wash" aria-labelledby="demo-h">
          <h2 id="demo-h" className="text-[17px] font-semibold">Demo data</h2>
          <p className="text-[15px] text-ink-2">
            Seven sample quotes across every status (one with options, one with a deposit, one with add-ons) and a starter item library.
            Every demo row is marked Demo and only you can see or remove it.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button type="button" onClick={demo.load} disabled={Boolean(demo.busy)} className="btn-primary flex-1">
              {demo.busy === "load" ? "Loading demo data…" : demoCount ? "Demo data loaded" : "Load demo data"}
            </button>
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={Boolean(demo.busy)} className="btn-secondary flex-1 py-3.5">
              Remove demo data
            </button>
          </div>
          {demo.error && <p className="field-error"><Icon name="alert" size={15} className="mt-[1px]" />{demo.error}</p>}
        </section>

        <section className="card p-5 space-y-3">
          <div className="text-[13px] text-ink-3">Signed in{email ? ` as ${email}` : ""}</div>
          <button type="button" onClick={() => supabase.auth.signOut()} className="btn-secondary w-full py-3.5"><Icon name="logout" size={18} /> Sign out</button>
        </section>
      </div>

      <ConfirmSheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove demo data?" danger
        confirmLabel="Remove demo data" busy={demo.busy === "remove"} error={demo.error}
        onConfirm={async () => { if (await demo.remove()) setConfirmRemove(false); }}
        body={<p>Deletes every quote and library item marked Demo that you loaded{demoCount ? ` (${demoCount} quotes)` : ""}. Your real quotes and items are not touched.</p>} />
    </AppShell>
  );
}

function Row({ label, value }) {
  return (
    <div className="py-3 flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-6">
      <dt className="text-ink-3">{label}</dt>
      <dd className="font-medium sm:text-right break-words">{value}</dd>
    </div>
  );
}
