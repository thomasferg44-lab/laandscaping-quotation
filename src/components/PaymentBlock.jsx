import { companyConfig } from "../../companyConfig.js";
import { paymentBlock } from "../lib/payment";
import Icon from "./ui/Icon.jsx";

// Bank/EFT details plus the payment link when one is configured. Same block
// on the customer's quote page, the invoice view and (as text) the PDF.
export default function PaymentBlock({ quote, reference, compact = false }) {
  const p = paymentBlock(companyConfig, quote, reference);
  if (!p) return null;
  return (
    <section aria-labelledby="pay-h" className={compact ? "space-y-2" : "rounded-[14px] border border-hairline px-4 py-4 space-y-2.5"} data-testid="payment-block">
      <h2 id="pay-h" className="text-[15px] font-semibold">{p.title}</h2>
      {p.note && <p className="text-[13px] text-ink-3">{p.note}</p>}
      {p.instructions && <p className="text-[14px] text-ink-2">{p.instructions}</p>}
      {p.reference && <p className="text-[13px] text-ink-3">Reference: <span className="tabular">{p.reference}</span></p>}
      {p.link && (
        <a href={p.link} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full sm:w-auto py-3">
          <Icon name="link" size={18} /> Pay online
        </a>
      )}
    </section>
  );
}
