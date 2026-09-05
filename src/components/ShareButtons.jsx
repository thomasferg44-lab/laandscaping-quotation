import { useEffect, useMemo, useState } from "react";
import { buildShareLinks } from "../lib/shareLinks";
import { advanceStatus } from "../lib/quoteStatus";

// WhatsApp / Email / Copy link. All three carry the same /quote/:id URL.
// The first share of a draft flips it to 'sent' via the shared status path.
//
// WhatsApp and Email are real <a> elements: the browser follows the href
// synchronously (no popup-blocker issues), and the status flip runs in the
// background from onClick.
export default function ShareButtons({ quote, disabledReason, onStatusChange }) {
  const links = useMemo(() => buildShareLinks(quote), [quote.id, quote.customer_name, quote.customer_phone, quote.customer_email]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function markSent() {
    if (quote.status !== "draft") return;
    try {
      const row = await advanceStatus(quote.id, "draft", "sent");
      if (row) onStatusChange?.(row);
    } catch (e) {
      setError(`Link opened, but the quote could not be marked as sent: ${e.message}`);
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
      setCopied(true);
      markSent();
    } catch {
      setError("Couldn't copy automatically. Long-press the link below to copy it.");
    }
  }

  const blocked = Boolean(disabledReason);
  const btn = "flex-1 min-w-[7.5rem] inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium border";
  const enabled = "bg-white border-gray-300 text-gray-800 hover:bg-gray-50";
  const off = "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed";

  const waReason = blocked ? disabledReason : !links.whatsapp ? "Add a valid phone number to send via WhatsApp" : null;
  const mailReason = blocked ? disabledReason : !links.mailto ? "Add a valid email address to send via email" : null;

  return (
    <section className="rounded-xl bg-white border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Send to customer</h2>
        {quote.status !== "draft" && <span className="text-xs text-gray-500">Sent · sharing again won't change status</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {waReason ? (
          <button type="button" disabled className={`${btn} ${off}`} title={waReason}>💬 WhatsApp</button>
        ) : (
          <a href={links.whatsapp} target="_blank" rel="noreferrer" onClick={markSent} className={`${btn} ${enabled}`}>💬 WhatsApp</a>
        )}
        {mailReason ? (
          <button type="button" disabled className={`${btn} ${off}`} title={mailReason}>✉️ Email</button>
        ) : (
          <a href={links.mailto} onClick={markSent} className={`${btn} ${enabled}`}>✉️ Email</a>
        )}
        <button type="button" onClick={copyLink} disabled={blocked} title={blocked ? disabledReason : undefined}
          className={`${btn} ${blocked ? off : enabled}`}>
          {copied ? "✅ Copied!" : "🔗 Copy link"}
        </button>
      </div>

      {(waReason || mailReason) && (
        <ul className="text-xs text-gray-500 space-y-0.5">
          {waReason && <li>WhatsApp: {waReason}</li>}
          {mailReason && mailReason !== waReason && <li>Email: {mailReason}</li>}
        </ul>
      )}

      <div className="text-xs text-gray-500 break-all">
        Link: <a href={links.quoteUrl} target="_blank" rel="noreferrer" className="underline">{links.quoteUrl}</a>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
