"use client";

/** A row of buttons, one of them chosen (the Profit page filters). */
export function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-panel p-0.5 text-xs" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          className={`rounded-md px-2.5 py-1 ${value === o.id ? "bg-panel-2 font-semibold text-text" : "text-muted hover:text-text"}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
