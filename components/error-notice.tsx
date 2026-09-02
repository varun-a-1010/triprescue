"use client";

import type { ReactNode } from "react";
import { clearError, refresh, seed, type AppErrorView } from "@/lib/client/store";
import { Button, Icon } from "./ui";

const REFRESH_CODES = new Set(["OFFER_EXPIRED", "TRIP_CHANGED", "PREVIEW_EXPIRED"]);
const WAIT_CODES = new Set(["RATE_LIMITED", "PROVIDER_UNAVAILABLE"]);

/** Shown at the top of the flow column. Never unmounts the trip beneath it. */
export function ErrorNotice({ error, busy }: { error: AppErrorView; busy: string | null }) {
  const locked = busy !== null;

  let action: ReactNode = null;
  if (error.code === "NO_DEMO_ORDER") {
    action = (
      <Button
        size="sm"
        variant="primary"
        disabled={locked}
        onClick={() => {
          seed(false).catch(() => {});
        }}
      >
        Create sandbox trip
      </Button>
    );
  } else if (REFRESH_CODES.has(error.code)) {
    action = (
      <Button
        size="sm"
        variant="secondary"
        disabled={locked}
        onClick={() => {
          refresh().catch(() => {});
        }}
      >
        Refresh trip
      </Button>
    );
  } else if (WAIT_CODES.has(error.code)) {
    action = <span className="text-sm text-ink-2">Wait a moment, then try the same action again.</span>;
  } else if (error.code === "BUSY") {
    action = <span className="text-sm text-ink-2">Let the running action finish, then try again.</span>;
  } else if (error.retrySafe) {
    action = <span className="text-sm text-ink-2">Safe to try again.</span>;
  }

  return (
    <div role="alert" className="rounded-card border border-alert/50 bg-alert-soft p-4" data-error-code={error.code}>
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-alert" aria-hidden="true">
          <Icon name="warn" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <code className="font-mono text-xs text-alert-ink">{error.code}</code>
            <span className="font-medium text-ink">{error.message}</span>
          </p>
          {error.requestId ? <p className="mt-1 break-all font-mono text-[11px] text-ink-3">request {error.requestId}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {action}
            <Button size="sm" variant="ghost" onClick={clearError}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
