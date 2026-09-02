"use client";

import type { DisruptionSummary } from "@/lib/types";
import { instantLabel } from "./format";
import { Itinerary } from "./itinerary";
import { Icon } from "./ui";

export function DisruptionBanner({ disruption, compact = false }: { disruption: DisruptionSummary; compact?: boolean }) {
  return (
    <section
      aria-labelledby="disruption-heading"
      className={`rounded-card border border-alert/40 bg-alert-soft ${compact ? "px-4 py-3" : "p-5"}`}
      data-disruption-status={disruption.status}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-alert" aria-hidden="true">
          <Icon name="warn" size={compact ? 16 : 20} />
        </span>
        <div className="min-w-0 flex-1">
          {compact ? (
            <p className="text-sm">
              <span id="disruption-heading" className="font-semibold text-alert-ink">
                Simulated airline schedule change
              </span>
              <span className="text-ink-2"> — {disruption.message}</span>
            </p>
          ) : (
            <>
              <h2 id="disruption-heading" className="font-semibold text-alert-ink">
                Simulated airline schedule change
              </h2>
              <p className="mt-0.5 text-ink">{disruption.message}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-2">
                <span>Received {instantLabel(disruption.receivedAt)}</span>
                <span>Provider status: {disruption.status}</span>
              </p>
              {disruption.previous ? (
                <div className="mt-4 border-t border-alert/20 pt-3">
                  <p className="text-sm font-medium text-ink-2">Before the change</p>
                  <Itinerary itinerary={disruption.previous} tone="removed" size="sm" className="mt-1" />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
