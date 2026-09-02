"use client";

import type { TripSummary } from "@/lib/types";
import { airportName, firstSegment, lastSegment, routeCodes, stopsLabel } from "./format";
import { Itinerary } from "./itinerary";
import { Icon, Tag } from "./ui";

export function TripCard({ trip, heading = "Your booking" }: { trip: TripSummary; heading?: string }) {
  const first = firstSegment(trip.itinerary);
  const last = lastSegment(trip.itinerary);
  const codes = routeCodes(trip.itinerary);
  const orderLabel = trip.providerMode === "duffel" ? "Duffel test order" : "Fixture order";

  const statusTag =
    trip.status === "booked" ? (
      <Tag tone="accent" icon={<Icon name="check" size={12} />}>
        Booked
      </Tag>
    ) : trip.status === "changed" ? (
      <Tag tone="accent" icon={<Icon name="swap" size={12} />}>
        Changed
      </Tag>
    ) : (
      <Tag tone="muted">Status unknown</Tag>
    );

  return (
    <article className="card p-5 sm:p-6" aria-labelledby="trip-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="trip-heading" className="text-sm font-medium text-ink-2">
            {heading}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {codes.map((code, i) => (
              <span key={`${code}-${i}`} className="inline-flex items-center gap-x-2">
                {i > 0 ? (
                  <>
                    <span className="sr-only">to</span>
                    <Icon name="arrow" size={22} className="opacity-50" />
                  </>
                ) : null}
                <span>{code}</span>
              </span>
            ))}
          </p>
          {first && last ? (
            <p className="mt-1 text-sm text-ink-2">
              {airportName(first.origin)} to {airportName(last.destination)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {statusTag}
          {trip.changeAvailable ? (
            <Tag tone="neutral" icon={<Icon name="swap" size={12} />}>
              Change available
            </Tag>
          ) : null}
        </div>
      </header>

      <div className="mt-5 border-t border-line pt-5">
        <Itinerary itinerary={trip.itinerary} size="md" showStops={false} />
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-2">Booking reference</dt>
          <dd className="mt-0.5 font-mono text-ink">{trip.bookingReference}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-2">{orderLabel}</dt>
          <dd className="mt-0.5 break-all font-mono text-xs text-ink">{trip.providerOrderId}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Stops</dt>
          <dd className="mt-0.5 text-ink">{stopsLabel(trip.itinerary)}</dd>
        </div>
      </dl>
    </article>
  );
}
