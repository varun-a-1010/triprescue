import type { ItinerarySummary, Money, ProviderMode } from "../types";

/**
 * Provider-neutral shapes. Adapters normalize raw provider payloads into these
 * before anything else sees them. Nothing here carries passenger data.
 */

export type ProviderSlice = {
  id: string;
  origin: string;
  destination: string;
  /** YYYY-MM-DD, local to the origin airport */
  departureDate: string;
  itinerary: ItinerarySummary;
};

export type ProviderAirlineChange = {
  id: string;
  createdAt: string;
  actionTaken: string | null;
  availableActions: string[];
  added: ItinerarySummary;
  removed: ItinerarySummary;
};

export type ProviderOrder = {
  id: string;
  bookingReference: string;
  ownerCode: string | null;
  liveMode: boolean;
  availableActions: string[];
  slices: ProviderSlice[];
  airlineChanges: ProviderAirlineChange[];
  total: Money;
  createdAt: string;
};

export type ProviderChangeOffer = {
  id: string;
  expiresAt: string;
  /** Amount payable for the change (fare difference + penalty). May be zero or negative. */
  changeTotal: Money;
  penalty: Money;
  newTotal: Money;
  add: ItinerarySummary;
  remove: ItinerarySummary;
};

export type ProviderPendingChange = {
  id: string;
  orderId: string;
  expiresAt: string;
  confirmedAt: string | null;
  changeTotal: Money;
  penalty: Money;
  newTotal: Money;
  add: ItinerarySummary;
  remove: ItinerarySummary;
};

export type ChangeSearchParams = {
  orderId: string;
  removeSliceId: string;
  origin: string;
  destination: string;
  departureDate: string;
  cabinClass: "economy";
};

export interface FlightRecoveryProvider {
  readonly mode: ProviderMode;
  /** Creates a fresh sandbox order for the demo route. */
  createDemoOrder(input: { departureDate: string }): Promise<ProviderOrder>;
  getOrder(orderId: string): Promise<ProviderOrder>;
  /** Generates exactly ONE simulated airline-initiated change. Mutating. */
  simulateAirlineChange(orderId: string): Promise<ProviderAirlineChange>;
  /** Creates a change request and returns the resulting offers. */
  searchChangeOffers(params: ChangeSearchParams): Promise<{ requestId: string; offers: ProviderChangeOffer[] }>;
  getChangeOffer(offerId: string): Promise<ProviderChangeOffer>;
  /** Creates a pending (unconfirmed) order change from an offer. */
  createPendingChange(offerId: string): Promise<ProviderPendingChange>;
  getPendingChange(changeId: string): Promise<ProviderPendingChange>;
  /** Confirms the pending change. `payment` is required only when changeTotal is positive. */
  confirmChange(changeId: string, payment: Money | null): Promise<ProviderPendingChange>;
}
