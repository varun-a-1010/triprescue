import { createHash } from "node:crypto";
import type { ItinerarySummary } from "./types";
import type { ProviderOrder } from "./providers/types";

/**
 * A stable digest of the material itinerary. Any change to slice ids,
 * flights, or times produces a different fingerprint, which is what lets the
 * apply step refuse to act on a trip that moved underneath a preview.
 */
export function itineraryKey(itinerary: ItinerarySummary): string {
  return itinerary.segments
    .map((s) => `${s.carrierCode}${s.flightNumber}|${s.origin}>${s.destination}|${s.departingAt}|${s.arrivingAt}`)
    .join(";");
}

export function orderFingerprint(order: ProviderOrder): string {
  const material = order.slices.map((s) => `${s.id}:${itineraryKey(s.itinerary)}`).join("||");
  return createHash("sha256").update(`${order.id}::${material}`).digest("hex").slice(0, 24);
}

/** True when two itineraries describe the same flights at the same instants. */
export function sameItinerary(a: ItinerarySummary, b: ItinerarySummary): boolean {
  if (a.segments.length !== b.segments.length) return false;
  return a.segments.every((seg, i) => {
    const other = b.segments[i];
    return (
      seg.carrierCode === other.carrierCode &&
      seg.flightNumber === other.flightNumber &&
      seg.origin === other.origin &&
      seg.destination === other.destination &&
      Date.parse(seg.departingAt) === Date.parse(other.departingAt) &&
      Date.parse(seg.arrivingAt) === Date.parse(other.arrivingAt)
    );
  });
}
