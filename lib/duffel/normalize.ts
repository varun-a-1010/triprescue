import type { ItinerarySummary, Money } from "../types";
import { localDateOf, localToIso } from "../time";
import { normalizeAmount } from "../money";
import type {
  ProviderAirlineChange,
  ProviderChangeOffer,
  ProviderOrder,
  ProviderPendingChange,
  ProviderSlice,
} from "../providers/types";

/**
 * Minimal raw shapes we read from Duffel. Declared locally (rather than
 * importing the SDK's types) so the adapter tolerates SDK typing quirks and so
 * nothing outside lib/duffel can depend on a Duffel shape. Passenger fields are
 * deliberately absent: they are never read.
 */
export type RawPlace = { iata_code?: string | null; time_zone?: string | null };
export type RawSegment = {
  id?: string;
  origin: RawPlace;
  destination: RawPlace;
  departing_at: string;
  arriving_at: string;
  marketing_carrier?: { iata_code?: string | null } | null;
  marketing_carrier_flight_number?: string | null;
  operating_carrier?: { iata_code?: string | null } | null;
  operating_carrier_flight_number?: string | null;
};
export type RawSlice = {
  id: string;
  origin: RawPlace;
  destination: RawPlace;
  segments: RawSegment[];
};
export type RawAirlineInitiatedChange = {
  id: string;
  created_at: string;
  action_taken: string | null;
  available_actions?: string[] | null;
  added: RawSlice[];
  removed: RawSlice[];
};
export type RawOrder = {
  id: string;
  booking_reference: string;
  owner?: { iata_code?: string | null } | null;
  live_mode: boolean;
  available_actions?: string[] | null;
  slices: RawSlice[];
  airline_initiated_changes?: RawAirlineInitiatedChange[] | null;
  total_amount: string;
  total_currency: string;
  created_at: string;
};
export type RawChangeOffer = {
  id: string;
  expires_at: string;
  change_total_amount: string | null;
  change_total_currency: string | null;
  penalty_amount?: string | null;
  penalty_currency?: string | null;
  penalty_total_amount?: string | null;
  penalty_total_currency?: string | null;
  new_total_amount: string | null;
  new_total_currency: string | null;
  slices: { add: RawSlice[]; remove: RawSlice[] };
};
export type RawOrderChange = RawChangeOffer & {
  order_id: string;
  confirmed_at: string | null;
};

const DEFAULT_TZ = "UTC";

function zoneOf(place: RawPlace | undefined): string {
  return place?.time_zone && place.time_zone.length > 0 ? place.time_zone : DEFAULT_TZ;
}

function code(place: RawPlace | undefined): string {
  return place?.iata_code ?? "???";
}

export function normalizeSegment(seg: RawSegment): ItinerarySummary["segments"][number] {
  return {
    origin: code(seg.origin),
    destination: code(seg.destination),
    departingAt: localToIso(seg.departing_at, zoneOf(seg.origin)),
    arrivingAt: localToIso(seg.arriving_at, zoneOf(seg.destination)),
    carrierCode: seg.marketing_carrier?.iata_code ?? seg.operating_carrier?.iata_code ?? "??",
    flightNumber: seg.marketing_carrier_flight_number ?? seg.operating_carrier_flight_number ?? "",
  };
}

export function normalizeItinerary(slices: RawSlice[]): ItinerarySummary {
  const segments = slices.flatMap((s) => s.segments.map(normalizeSegment));
  return { segments, stops: Math.max(0, segments.length - 1) };
}

export function normalizeSlice(slice: RawSlice): ProviderSlice {
  const itinerary = normalizeItinerary([slice]);
  const first = itinerary.segments[0];
  return {
    id: slice.id,
    origin: code(slice.origin),
    destination: code(slice.destination),
    departureDate: first ? localDateOf(first.departingAt) : "",
    itinerary,
  };
}

function money(amount: string | null | undefined, currency: string | null | undefined, fallbackCurrency: string): Money {
  return { amount: normalizeAmount(amount ?? "0"), currency: currency ?? fallbackCurrency };
}

export function normalizeAirlineChange(raw: RawAirlineInitiatedChange): ProviderAirlineChange {
  return {
    id: raw.id,
    createdAt: raw.created_at,
    actionTaken: raw.action_taken,
    availableActions: raw.available_actions ?? [],
    added: normalizeItinerary(raw.added ?? []),
    removed: normalizeItinerary(raw.removed ?? []),
  };
}

export function normalizeOrder(raw: RawOrder): ProviderOrder {
  return {
    id: raw.id,
    bookingReference: raw.booking_reference,
    ownerCode: raw.owner?.iata_code ?? null,
    liveMode: raw.live_mode,
    availableActions: raw.available_actions ?? [],
    slices: raw.slices.map(normalizeSlice),
    airlineChanges: (raw.airline_initiated_changes ?? []).map(normalizeAirlineChange),
    total: money(raw.total_amount, raw.total_currency, "GBP"),
    createdAt: raw.created_at,
  };
}

export function normalizeChangeOffer(raw: RawChangeOffer): ProviderChangeOffer {
  const currency = raw.change_total_currency ?? raw.new_total_currency ?? "GBP";
  return {
    id: raw.id,
    expiresAt: raw.expires_at,
    changeTotal: money(raw.change_total_amount, raw.change_total_currency, currency),
    penalty: money(raw.penalty_amount ?? raw.penalty_total_amount, raw.penalty_currency ?? raw.penalty_total_currency, currency),
    newTotal: money(raw.new_total_amount, raw.new_total_currency, currency),
    add: normalizeItinerary(raw.slices?.add ?? []),
    remove: normalizeItinerary(raw.slices?.remove ?? []),
  };
}

export function normalizeOrderChange(raw: RawOrderChange): ProviderPendingChange {
  const offer = normalizeChangeOffer(raw);
  return {
    id: raw.id,
    orderId: raw.order_id,
    expiresAt: raw.expires_at,
    confirmedAt: raw.confirmed_at ?? null,
    changeTotal: offer.changeTotal,
    penalty: offer.penalty,
    newTotal: offer.newTotal,
    add: offer.add,
    remove: offer.remove,
  };
}
