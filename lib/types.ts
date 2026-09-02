/**
 * Normalized application types. These are the ONLY shapes that cross the
 * server/client boundary or reach a WebMCP caller. Provider-specific shapes
 * (Duffel payloads) stay behind lib/providers/*.
 */

export type ProviderMode = "duffel" | "fixture";

export type Money = {
  /** Decimal string, e.g. "42.00". Never do floating-point arithmetic on this. */
  amount: string;
  /** ISO 4217 code */
  currency: string;
};

export type SegmentSummary = {
  origin: string;
  destination: string;
  /** ISO 8601 with a UTC offset, e.g. 2026-10-17T10:00:00+01:00 */
  departingAt: string;
  arrivingAt: string;
  carrierCode: string;
  flightNumber: string;
};

export type ItinerarySummary = {
  segments: SegmentSummary[];
  stops: number;
};

export type TripStatus = "booked" | "changed" | "unknown";

export type TripSummary = {
  /** App-scoped opaque identifier */
  tripId: string;
  /** Provider test-mode order id (ord_...) — shown as sandbox proof, never accepted as input */
  providerOrderId: string;
  /** Airline booking reference (PNR) */
  bookingReference: string;
  carrierCode: string | null;
  /** Billing currency of the order; constraints like maxExtraAmount are in this currency */
  currency: string;
  itinerary: ItinerarySummary;
  status: TripStatus;
  changeAvailable: boolean;
  sandbox: true;
  providerMode: ProviderMode;
};

export type DisruptionSummary = {
  kind: "airline_schedule_change";
  status: string;
  receivedAt: string;
  /** Normalized application copy, never provider HTML */
  message: string;
  /** Itinerary as it was before the simulated change, when known */
  previous: ItinerarySummary | null;
};

export type RecoveryPreferences = {
  /** ISO 8601 with offset */
  arriveBy?: string;
  /** Decimal string in the trip currency */
  maxExtraAmount?: string;
  maxStops?: 0 | 1 | 2;
};

export type RecoveryOption = {
  optionKey: string;
  itinerary: ItinerarySummary;
  fareDelta: Money;
  penalty: Money;
  totalCost: Money;
  expiresAt: string;
  eligible: boolean;
  eligibilityReasons: string[];
};

export type RecoverySearchResult = {
  searchId: string;
  currency: string;
  constraints: RecoveryPreferences;
  /** Ranked, eligible options */
  options: RecoveryOption[];
  /** Options that failed a constraint, with the reason(s) */
  ineligible: RecoveryOption[];
  expiresAt: string;
  sandbox: true;
};

export type ChangePreview = {
  previewId: string;
  before: ItinerarySummary;
  after: ItinerarySummary;
  fareDelta: Money;
  penalty: Money;
  totalCost: Money;
  expiresAt: string;
  sandbox: true;
};

export type ChangeResult = {
  status: "confirmed" | "already_confirmed";
  before: ItinerarySummary;
  after: ItinerarySummary;
  totalCost: Money;
  confirmedAt: string;
  verifiedAt: string;
  /** True only when the refetched order itinerary matches `after` */
  verified: boolean;
  sandbox: true;
};

export type Verification = {
  applied: boolean;
  verified: boolean;
  verifiedAt: string;
  confirmedAt: string | null;
  intended: ItinerarySummary | null;
};

export type TripState = {
  trip: TripSummary | null;
  disruption: DisruptionSummary | null;
  /** Active, unconsumed preview if any */
  preview: ChangePreview | null;
  providerMode: ProviderMode;
};

export type DisruptResult = TripState & {
  status: "triggered" | "already_triggered";
};

export type StatusResult = TripState & {
  verification: Verification;
};

export type SeedResult = TripState & {
  status: "created" | "existing";
};

/** Consistent JSON envelope for every route */
export type ApiSuccess<T> = { ok: true; data: T; requestId: string };
export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    retrySafe: boolean;
    details?: Record<string, string | number | boolean>;
  };
  requestId: string;
};
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
