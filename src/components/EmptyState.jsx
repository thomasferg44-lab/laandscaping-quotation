import Icon from "./ui/Icon.jsx";

// Designed empty state (spec §3): soft aura wash, one line icon, one
// sentence, one action (plus an optional quiet second one).
export default function EmptyState({ icon = "doc", title, body, action, secondary }) {
  return (
    <div className="card aura-wash px-6 py-12 text-center animate-rise">
      <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-white shadow-card flex items-center justify-center text-ink-2">
        <Icon name={icon} size={26} />
      </div>
      <h2 className="text-[19px] font-semibold">{title}</h2>
      {body && <p className="mt-1.5 text-[15px] text-ink-3 max-w-sm mx-auto">{body}</p>}
      {(action || secondary) && (
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center items-stretch sm:items-center max-w-xs sm:max-w-none mx-auto">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}
