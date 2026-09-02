"use client";

import type { Phase } from "@/lib/client/store";

const STEPS = [
  { key: "booked", label: "Booked" },
  { key: "disrupted", label: "Disruption" },
  { key: "options", label: "Options" },
  { key: "preview", label: "Preview" },
  { key: "verified", label: "Confirmed" },
] as const;

function stepIndex(phase: Phase): number {
  switch (phase) {
    case "booked":
      return 0;
    case "disrupted":
      return 1;
    case "options":
      return 2;
    case "preview":
    case "applying":
      return 3;
    case "verified":
      return 4;
    default:
      return -1;
  }
}

/** The recovery really is a sequence, so a progress rail is information, not decoration. */
export function Stepper({ phase }: { phase: Phase }) {
  const current = stepIndex(phase);
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Recovery progress">
      {STEPS.map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={step.key} className="min-w-0" aria-current={state === "current" ? "step" : undefined} data-step-state={state}>
            <span className={`block h-1 rounded-full ${state === "todo" ? "bg-line" : "bg-accent"}`} aria-hidden="true" />
            <span className={`mt-1.5 block truncate text-xs ${state === "current" ? "font-semibold text-ink" : state === "done" ? "text-ink-2" : "text-ink-3"}`}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
