import type { ItinerarySummary, Money } from "../types";
import { addMinutesIso, localToIso, nowIso } from "../time";
import { AppError } from "../errors";
import type {
  ChangeSearchParams,
  FlightRecoveryProvider,
  ProviderAirlineChange,
  ProviderChangeOffer,
  ProviderOrder,
  ProviderPendingChange,
} from "./types";

/**
 * Deterministic in-memory provider for local development and tests. It
 * mirrors the Duffel lifecycle (order → simulated airline change → change
 * offers → pending change → confirm) without any network. State is
 * process-local and NOT durable; the UI shows a "Fixture" badge whenever it is
 * in use.
 */

type FixtureOrder = ProviderOrder & { cabinClass: "economy" };
type FixtureOffer = ProviderChangeOffer & { orderId: string; requestId: string };
type FixturePending = ProviderPendingChange & { offerId: string };

type FixtureStore = {
  seq: number;
  orders: Map<string, FixtureOrder>;
  offers: Map<string, FixtureOffer>;
  pending: Map<string, FixturePending>;
  hooks: {
    failNext: Partial<Record<keyof FlightRecoveryProvider, AppError>>;
  };
};

const TZ = "Europe/London";
const CARRIER = "ZZ";
const OFFER_TTL_MINUTES = 30;

declare global {
  // eslint-disable-next-line no-var
  var __triprescueFixtureStore: FixtureStore | undefined;
}

function store(): FixtureStore {
  if (!globalThis.__triprescueFixtureStore) {
    globalThis.__triprescueFixtureStore = {
      seq: 0,
      orders: new Map(),
      offers: new Map(),
      pending: new Map(),
      hooks: { failNext: {} },
    };
  }
  return globalThis.__triprescueFixtureStore;
}

function nextId(prefix: string): string {
  const s = store();
  s.seq += 1;
  return `${prefix}_fix${String(s.seq).padStart(5, "0")}`;
}

function money(amount: string, currency = "GBP"): Money {
  return { amount, currency };
}

function segment(
  origin: string,
  destination: string,
  date: string,
  dep: string,
  arr: string,
  flightNumber: string,
): ItinerarySummary["segments"][number] {
  return {
    origin,
    destination,
    departingAt: localToIso(`${date}T${dep}:00`, TZ),
    arrivingAt: localToIso(`${date}T${arr}:00`, TZ),
    carrierCode: CARRIER,
    flightNumber,
  };
}

function itinerary(...segments: ItinerarySummary["segments"]): ItinerarySummary {
  return { segments, stops: Math.max(0, segments.length - 1) };
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function maybeFail(op: keyof FlightRecoveryProvider): void {
  const err = store().hooks.failNext[op];
  if (err) {
    delete store().hooks.failNext[op];
    throw err;
  }
}

export class FixtureProvider implements FlightRecoveryProvider {
  readonly mode = "fixture" as const;

  async createDemoOrder({ departureDate }: { departureDate: string }): Promise<ProviderOrder> {
    maybeFail("createDemoOrder");
    const id = nextId("ord");
    const sliceId = nextId("sli");
    const order: FixtureOrder = {
      id,
      bookingReference: `FX${id.slice(-4).toUpperCase()}`,
      ownerCode: CARRIER,
      liveMode: false,
      availableActions: ["cancel", "change", "update"],
      slices: [
        {
          id: sliceId,
          origin: "LHR",
          destination: "LTN",
          departureDate,
          itinerary: itinerary(segment("LHR", "LTN", departureDate, "10:00", "11:05", "0101")),
        },
      ],
      airlineChanges: [],
      total: money("64.00"),
      createdAt: nowIso(),
      cabinClass: "economy",
    };
    store().orders.set(id, order);
    return clone(order);
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    maybeFail("getOrder");
    const order = store().orders.get(orderId);
    if (!order) throw new AppError("NO_DEMO_ORDER", "The sandbox order no longer exists.");
    return clone(order);
  }

  async simulateAirlineChange(orderId: string): Promise<ProviderAirlineChange> {
    maybeFail("simulateAirlineChange");
    const order = store().orders.get(orderId);
    if (!order) throw new AppError("NO_DEMO_ORDER", "The sandbox order no longer exists.");
    const current = order.slices[0];
    const removed = clone(current.itinerary);
    // Airline pushes the flight back by five and a half hours.
    const added = itinerary(segment(current.origin, current.destination, current.departureDate, "15:30", "16:35", "0101"));
    const change: ProviderAirlineChange = {
      id: nextId("aic"),
      createdAt: nowIso(),
      actionTaken: null,
      availableActions: ["accept", "cancel", "change"],
      added,
      removed,
    };
    order.slices = [{ ...current, id: nextId("sli"), itinerary: clone(added) }];
    order.airlineChanges.push(change);
    return clone(change);
  }

  async searchChangeOffers(params: ChangeSearchParams): Promise<{ requestId: string; offers: ProviderChangeOffer[] }> {
    maybeFail("searchChangeOffers");
    const order = store().orders.get(params.orderId);
    if (!order) throw new AppError("NO_DEMO_ORDER", "The sandbox order no longer exists.");
    const slice = order.slices.find((s) => s.id === params.removeSliceId);
    if (!slice) {
      throw new AppError("TRIP_CHANGED", "The slice to remove is no longer part of the order.", {
        details: { reason: "unknown_slice" },
      });
    }
    const requestId = nextId("ocr");
    const date = params.departureDate;
    const remove = clone(slice.itinerary);
    const expiresAt = addMinutesIso(nowIso(), OFFER_TTL_MINUTES);
    const candidates: Array<{ add: ItinerarySummary; changeTotal: string; penalty: string }> = [
      { add: itinerary(segment("LHR", "LTN", date, "12:00", "13:05", "0103")), changeTotal: "42.00", penalty: "20.00" },
      { add: itinerary(segment("LHR", "LTN", date, "14:30", "15:35", "0105")), changeTotal: "25.00", penalty: "20.00" },
      {
        add: itinerary(
          segment("LHR", "MAN", date, "11:00", "12:10", "0221"),
          segment("MAN", "LTN", date, "13:00", "14:05", "0222"),
        ),
        changeTotal: "96.00",
        penalty: "20.00",
      },
      { add: itinerary(segment("LHR", "LTN", date, "19:00", "20:05", "0109")), changeTotal: "12.00", penalty: "20.00" },
    ];
    const offers: FixtureOffer[] = candidates.map((c) => ({
      id: nextId("oco"),
      orderId: order.id,
      requestId,
      expiresAt,
      changeTotal: money(c.changeTotal),
      penalty: money(c.penalty),
      newTotal: money("64.00"),
      add: c.add,
      remove: clone(remove),
    }));
    for (const o of offers) store().offers.set(o.id, o);
    return { requestId, offers: offers.map(clone) };
  }

  async getChangeOffer(offerId: string): Promise<ProviderChangeOffer> {
    maybeFail("getChangeOffer");
    const offer = store().offers.get(offerId);
    if (!offer) throw new AppError("OFFER_EXPIRED", "That change offer is no longer available.");
    return clone(offer);
  }

  async createPendingChange(offerId: string): Promise<ProviderPendingChange> {
    maybeFail("createPendingChange");
    const offer = store().offers.get(offerId);
    if (!offer) throw new AppError("OFFER_EXPIRED", "That change offer is no longer available.");
    if (Date.parse(offer.expiresAt) < Date.now()) {
      throw new AppError("OFFER_EXPIRED", "That change offer has expired.");
    }
    const pending: FixturePending = {
      id: nextId("ocg"),
      orderId: offer.orderId,
      offerId,
      expiresAt: offer.expiresAt,
      confirmedAt: null,
      changeTotal: clone(offer.changeTotal),
      penalty: clone(offer.penalty),
      newTotal: clone(offer.newTotal),
      add: clone(offer.add),
      remove: clone(offer.remove),
    };
    store().pending.set(pending.id, pending);
    return clone(pending);
  }

  async getPendingChange(changeId: string): Promise<ProviderPendingChange> {
    maybeFail("getPendingChange");
    const pending = store().pending.get(changeId);
    if (!pending) throw new AppError("PREVIEW_EXPIRED", "That staged change no longer exists.");
    return clone(pending);
  }

  async confirmChange(changeId: string, payment: Money | null): Promise<ProviderPendingChange> {
    maybeFail("confirmChange");
    const pending = store().pending.get(changeId);
    if (!pending) throw new AppError("PREVIEW_EXPIRED", "That staged change no longer exists.");
    if (pending.confirmedAt) {
      throw new AppError("ALREADY_CONFIRMED", "This change was already confirmed.");
    }
    if (Date.parse(pending.expiresAt) < Date.now()) {
      throw new AppError("PREVIEW_EXPIRED", "That staged change has expired.");
    }
    const positive = Number(pending.changeTotal.amount) > 0;
    if (positive) {
      if (!payment || payment.amount !== pending.changeTotal.amount || payment.currency !== pending.changeTotal.currency) {
        throw new AppError("PROVIDER_UNAVAILABLE", "Payment did not match the change total.", {
          retrySafe: false,
          details: { reason: "payment_mismatch" },
        });
      }
    }
    const order = store().orders.get(pending.orderId);
    if (!order) throw new AppError("NO_DEMO_ORDER", "The sandbox order no longer exists.");
    pending.confirmedAt = nowIso();
    const current = order.slices[0];
    order.slices = [{ ...current, id: nextId("sli"), itinerary: clone(pending.add) }];
    for (const change of order.airlineChanges) {
      if (!change.actionTaken) change.actionTaken = "changed";
    }
    return clone(pending);
  }
}

/** Test helpers — never used by app code. */
export const fixtureTestHooks = {
  reset(): void {
    globalThis.__triprescueFixtureStore = undefined;
  },
  failNext(op: keyof FlightRecoveryProvider, err: AppError): void {
    store().hooks.failNext[op] = err;
  },
  expireOffer(offerId: string): void {
    const offer = store().offers.get(offerId);
    if (offer) offer.expiresAt = new Date(Date.now() - 60000).toISOString();
  },
  expirePending(changeId: string): void {
    const p = store().pending.get(changeId);
    if (p) p.expiresAt = new Date(Date.now() - 60000).toISOString();
  },
  repriceOffer(offerId: string, amount: string): void {
    const offer = store().offers.get(offerId);
    if (offer) offer.changeTotal = { ...offer.changeTotal, amount };
    for (const p of store().pending.values()) {
      if (p.offerId === offerId) p.changeTotal = { ...p.changeTotal, amount };
    }
  },
  /** Mutates the order's itinerary out from under any search/preview. */
  perturbOrder(orderId: string): void {
    const order = store().orders.get(orderId);
    if (!order) return;
    const current = order.slices[0];
    const seg = current.itinerary.segments[0];
    order.slices = [
      {
        ...current,
        id: nextId("sli"),
        itinerary: itinerary({ ...seg, flightNumber: "0999" }),
      },
    ];
  },
  snapshot(): { orders: number; offers: number; pending: number; confirmed: number } {
    const s = store();
    return {
      orders: s.orders.size,
      offers: s.offers.size,
      pending: s.pending.size,
      confirmed: [...s.pending.values()].filter((p) => p.confirmedAt).length,
    };
  },
};
