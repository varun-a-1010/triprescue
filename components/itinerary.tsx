"use client";

import type { ItinerarySummary } from "@/lib/types";
import { carrierName, flightLabel, localDate, localTime, stopsLabel } from "./format";
import { Icon } from "./ui";

type Props = {
  itinerary: ItinerarySummary;
  /** "removed" strikes the times and dims the row; "added" is the replacement. */
  tone?: "default" | "removed" | "added";
  size?: "lg" | "md" | "sm";
  showStops?: boolean;
  className?: string;
};

const TIME_SIZE = { lg: "text-2xl sm:text-3xl", md: "text-xl", sm: "text-base" } as const;
const CODE_SIZE = { lg: "text-base", md: "text-sm", sm: "text-sm" } as const;

/**
 * The one itinerary renderer. Every card, the preview, the dialog and the
 * verified view use it, so a before/after comparison is visually exact.
 */
export function Itinerary({ itinerary, tone = "default", size = "md", showStops = true, className = "" }: Props) {
  const removed = tone === "removed";
  const primary = removed ? "text-ink-3" : "text-ink";
  const secondary = removed ? "text-ink-3" : "text-ink-2";
  return (
    <div className={className}>
      <ol className="flex flex-col gap-3">
        {itinerary.segments.map((s, i) => {
          const departDate = localDate(s.departingAt);
          const arriveDate = localDate(s.arrivingAt);
          return (
            <li key={`${i}-${s.carrierCode}${s.flightNumber}-${s.departingAt}`} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                <span
                  className={`font-semibold tracking-tight tabular-nums ${TIME_SIZE[size]} ${primary} ${
                    removed ? "line-through decoration-ink-3 decoration-2" : ""
                  }`}
                >
                  <time dateTime={s.departingAt}>{localTime(s.departingAt)}</time>
                  <span className="mx-1.5 font-normal opacity-50" aria-hidden="true">
                    →
                  </span>
                  <span className="sr-only">to</span>
                  <time dateTime={s.arrivingAt}>{localTime(s.arrivingAt)}</time>
                </span>
                <span className={`font-medium ${CODE_SIZE[size]} ${primary}`}>
                  {s.origin}
                  <span className="sr-only">to</span>
                  <Icon name="arrow" size={12} className="mx-1 inline opacity-60" />
                  {s.destination}
                </span>
              </div>
              <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-sm ${secondary}`}>
                <span>
                  {carrierName(s.carrierCode)} <span className="tabular-nums">{flightLabel(s)}</span>
                </span>
                <span>
                  {departDate}
                  {arriveDate !== departDate ? ` → ${arriveDate}` : ""}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {showStops ? <p className={`mt-2 text-sm ${secondary}`}>{stopsLabel(itinerary)}</p> : null}
    </div>
  );
}
