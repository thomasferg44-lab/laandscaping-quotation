import { buildTimeline } from "../lib/quoteMath";
import { companyConfig } from "../../companyConfig.js";
import Icon from "./ui/Icon.jsx";

const fmt = (iso, dateOnly) => {
  if (!iso) return null;
  const d = dateOnly ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`) : new Date(iso);
  return d.toLocaleString("en-ZA", dateOnly
    ? { day: "numeric", month: "short", year: "numeric", timeZone: companyConfig.timeZone }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: companyConfig.timeZone });
};

// created -> sent -> viewed -> accepted/expired (-> invoiced -> paid).
export default function Timeline({ quote }) {
  const steps = buildTimeline(quote, new Date(), companyConfig.timeZone);
  return (
    <ol className="relative" aria-label="Quote history">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const dot = {
          done: "bg-good text-white",
          current: "bg-brand text-brand-ink ring-4 ring-brand/15",
          todo: "bg-white border-2 border-fill-2 text-ink-4",
          bad: "bg-bad text-white",
        }[s.state];
        const reached = s.state !== "todo";
        return (
          <li key={s.key} className="relative flex gap-3.5 pb-5 last:pb-0" data-state={s.state}>
            {!last && <span className={`absolute left-[13px] top-7 bottom-0 w-[2px] ${reached && steps[i + 1].state !== "todo" ? "bg-good/40" : "bg-fill-2"}`} aria-hidden />}
            <span className={`relative z-10 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${dot}`}>
              {s.state === "bad" ? <Icon name="clock" size={15} strokeWidth={2} /> : reached ? <Icon name="check" size={15} strokeWidth={2.2} /> : null}
            </span>
            <div className="min-w-0 pt-0.5">
              <div className={`text-[15px] ${reached ? "font-semibold text-ink" : "text-ink-3"}`}>{s.label}</div>
              <div className="text-[13px] text-ink-3 tabular">
                {s.key === "expired"
                  ? `Valid until ${fmt(s.at, true)}`
                  : s.at ? fmt(s.at) : reached ? "Time not recorded" : "Not yet"}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
