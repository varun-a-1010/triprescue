"use client";

import { useAppState } from "@/lib/client/store";
import { Icon, Tag } from "./ui";

const LABEL = {
  duffel: "Duffel Sandbox",
  fixture: "Fixture Mode",
} as const;

const TITLE = {
  duffel: "Every booking on this page is a Duffel test-mode order. No real flights, no real money.",
  fixture: "Local fixture provider: no network calls, nothing real is booked.",
} as const;

/** Persistent sandbox label. Rendered in the header and again inside the confirmation dialog. */
export function ProviderBadge({ size = "md" }: { size?: "sm" | "md" }) {
  const mode = useAppState().providerMode;
  const label = mode ? LABEL[mode] : "Connecting…";
  const title = mode ? TITLE[mode] : "Waiting for the server to report which sandbox provider is active.";
  return (
    <Tag tone={mode ? "sandbox" : "muted"} size={size} icon={<Icon name="flask" size={size === "sm" ? 12 : 14} />} title={title} data-provider-mode={mode ?? "unknown"}>
      {label}
    </Tag>
  );
}
