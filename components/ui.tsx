"use client";

import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

export type IconName =
  | "check"
  | "cross"
  | "warn"
  | "clock"
  | "plus"
  | "minus"
  | "arrow"
  | "swap"
  | "flask"
  | "tools"
  | "refresh"
  | "chevron"
  | "agent"
  | "person";

const PATHS: Record<IconName, string> = {
  check: "M3 8.5l3.2 3.2L13 5",
  cross: "M4 4l8 8M12 4l-8 8",
  warn: "M8 2.2l6.3 11.3H1.7L8 2.2zM8 6.4v3.2M8 12.1v.2",
  clock: "M8 2.2a5.8 5.8 0 1 1 0 11.6A5.8 5.8 0 0 1 8 2.2zM8 4.8V8l2.4 1.5",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  arrow: "M2.5 8h11M9.5 4l4 4-4 4",
  swap: "M2.5 5.2h10.3L10.5 2.9M13.5 10.8H3.2l2.3 2.3",
  flask: "M6 1.8h4M7 1.8v4.6L3.4 12.6a1 1 0 0 0 .9 1.5h7.4a1 1 0 0 0 .9-1.5L9 6.4V1.8",
  tools: "M5 1.5v3M11 1.5v3M3 4.5h10v2.8a5 5 0 0 1-10 0V4.5zM8 12.3v2.2",
  refresh: "M13.3 8a5.3 5.3 0 1 1-1.7-3.9M13.3 2.3v3.4H9.9",
  chevron: "M6 3.5L10.5 8 6 12.5",
  agent: "M3 5.5h10v6H9.5L8 13.5 6.5 11.5H3v-6zM6 8.5h.01M10 8.5h.01",
  person: "M8 2.2a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8zM2.6 14a5.4 5.4 0 0 1 10.8 0",
};

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`spinner ${className}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  /** Shows a spinner and the busy label, and disables the button. */
  busy?: boolean;
  busyLabel?: string;
};

export function Button({ variant = "secondary", size = "md", busy = false, busyLabel, className = "", children, disabled, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, size === "md" ? "" : `btn-${size}`, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner /> : null}
      <span>{busy && busyLabel ? busyLabel : children}</span>
    </button>
  );
}

type TagProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "muted" | "accent" | "alert" | "sandbox";
  size?: "sm" | "md";
  icon?: ReactNode;
};

export function Tag({ tone = "neutral", size = "md", icon, className = "", children, ...rest }: TagProps) {
  const classes = ["pill", `pill-${tone}`, size === "sm" ? "pill-sm" : "", className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/** One row of a definition list: label on the left, tabular value on the right. */
export function Row({ label, value, strong = false, note }: { label: string; value: ReactNode; strong?: boolean; note?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? "mt-1 border-t border-line-strong pt-3" : ""}`}>
      <dt className={strong ? "font-semibold text-ink" : "text-ink-2"}>
        {label}
        {note ? <span className="block text-xs font-normal text-ink-3">{note}</span> : null}
      </dt>
      <dd className={`text-right tabular-nums ${strong ? "text-xl font-semibold text-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
