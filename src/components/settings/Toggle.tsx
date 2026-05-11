import React from "react";

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <button
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span>{label}</span>
      <span className="toggle-switch" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </button>
  );
}
