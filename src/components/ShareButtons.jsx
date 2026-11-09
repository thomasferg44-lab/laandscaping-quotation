import { useMemo, useState } from "react";
import { buildShareLinks } from "../lib/shareLinks";
import { advanceStatus } from "../lib/quoteStatus";
import Icon from "./ui/Icon.jsx";
import { useToast } from "./ui/Toast.jsx";

// WhatsApp / Email / Copy link. All three carry the same /quote/:id URL and
// the same prefilled message as v1. The first share of a draft flips it to
// 'sent' via the shared status path.
//
// WhatsApp and Email are real <a> elements: the browser follows the href
// synchronously (no popup-blocker issues), and the status flip runs in the
// background from onClick.
export default function ShareButtons({ quote, disabledReason, onStatusChange }) {
  const links = useMemo(() => buildShareLinks(quote), [quote.id, quote.customer_name, quote.customer_phone, quote.customer_email]);
  const [error, setError] = useState(null);
  const toast = useToast();

  async function markSent() {
    if (quote.status !== "draft") return;
    try {
      const row = await advanceStatus(quote.id, "draft", "sent");
      if (row) { onStatusChange?.(row); toast("Quote marked as sent"); }
    } catch {
      setError("The link opened, but the quote couldn't be marked as sent. Check your connection, then share again.");
    }
  }

  async function copyLink() {
    setError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(links.quoteUrl);
      } else {
        // Fallback for non-secure contexts (plain http on a LAN IP).
        const ta = document.createElement("textarea");
        ta.value = links.quoteUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast("Link copied");
      markSent();
    } catch {
      setError("Couldn't copy automatically. Long-press the link below to copy it.");
    }
  }

  const blocked = Boolean(disabledReason);
  const waReason = blocked ? disabledReason : !links.whatsapp ? "Add a valid phone number to send on WhatsApp" : null;
  const mailReason = blocked ? disabledReason : !links.mailto ? "Add a valid email address to send by email" : null;
  const btn = "btn flex-1 min-w-[8.5rem]";

  return (
    <section className="card p-5 space-y-4" aria-labelledby="send-h">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="send-h" className="text-[17px] font-semibold">Send to customer</h2>
          <p className="text-[13px] text-ink-3">
            {quote.status === "draft" ? "Sending marks the quote as sent." : "Already sent. Sharing again won't change its status."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {waReason ? (
          <button type="button" disabled className={`${btn} bg-fill text-ink-3`} title={waReason}><Icon name="chat" size={18} /> WhatsApp</button>
        ) : (
          <a href={links.whatsapp} target="_blank" rel="noreferrer" onClick={markSent} className={`${btn} bg-brand text-brand-ink`}>
            <Icon name="chat" size={18} /> WhatsApp
          </a>
        )}
        {mailReason ? (
          <button type="button" disabled className={`${btn} bg-fill text-ink-3`} title={mailReason}><Icon name="mail" size={18} /> Email</button>
        ) : (
          <a href={links.mailto} onClick={markSent} className={`${btn} bg-fill text-ink hover:bg-fill-2`}><Icon name="mail" size={18} /> Email</a>
        )}
        <button type="button" onClick={copyLink} disabled={blocked} title={blocked ? disabledReason : undefined}
          className={`${btn} bg-fill text-ink hover:bg-fill-2`}>
          <Icon name="link" size={18} /> Copy link
        </button>
      </div>

      {(waReason || mailReason) && (
        <ul className="text-[13px] text-ink-3 space-y-0.5">
          {waReason && <li>WhatsApp: {waReason}</li>}
          {mailReason && mailReason !== waReason && <li>Email: {mailReason}</li>}
        </ul>
      )}

      <a href={links.quoteUrl} target="_blank" rel="noreferrer"
        className="flex items-center min-h-[44px] rounded-input bg-fill px-3.5 py-2.5 text-[13px] text-action break-all hover:bg-fill-2">
        {links.quoteUrl}
      </a>
      {error && <p className="field-error"><Icon name="alert" size={15} className="mt-[1px]" />{error}</p>}
    </section>
  );
}
