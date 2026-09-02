import type { Duffel } from "@duffel/api";
import { AppError } from "../errors";
import { log } from "../log";
import type { Money } from "../types";
import { mapDuffelError, withReadRetry } from "../duffel/errors";
import {
  normalizeAirlineChange,
  normalizeChangeOffer,
  normalizeOrder,
  normalizeOrderChange,
  type RawAirlineInitiatedChange,
  type RawChangeOffer,
  type RawOrder,
  type RawOrderChange,
} from "../duffel/normalize";
import type {
  ChangeSearchParams,
  FlightRecoveryProvider,
  ProviderAirlineChange,
  ProviderChangeOffer,
  ProviderOrder,
  ProviderPendingChange,
} from "./types";

const DEMO_ROUTE = { origin: "LHR", destination: "LTN" } as const;
const DEMO_CARRIER = "ZZ";

/**
 * Obviously fictional passenger. Duffel test mode requires a passenger record;
 * this one is never returned to the page, logged, or included in any tool
 * output.
 */
const FICTIONAL_PASSENGER = {
  title: "ms" as const,
  gender: "f" as const,
  given_name: "Test",
  family_name: "Traveller",
  born_on: "1990-01-01",
  email: "test.traveller@example.com",
  phone_number: "+447911123456",
};

type OfferLite = {
  id: string;
  owner?: { iata_code?: string | null } | null;
  total_amount: string;
  total_currency: string;
  passengers: Array<{ id: string }>;
};

export class DuffelProvider implements FlightRecoveryProvider {
  readonly mode = "duffel" as const;

  constructor(private readonly duffel: Duffel) {}

  async createDemoOrder({ departureDate }: { departureDate: string }): Promise<ProviderOrder> {
    const started = Date.now();
    let offerRequest;
    try {
      offerRequest = await this.duffel.offerRequests.create({
        slices: [
          {
            origin: DEMO_ROUTE.origin,
            destination: DEMO_ROUTE.destination,
            departure_date: departureDate,
            arrival_time: null,
            departure_time: null,
          },
        ],
        passengers: [{ type: "adult" }],
        cabin_class: "economy",
        return_offers: true,
      });
    } catch (err) {
      throw mapDuffelError(err, "offer_requests.create");
    }

    const offers = ((offerRequest.data as { offers?: OfferLite[] }).offers ?? []).filter(
      (o) => o.owner?.iata_code === DEMO_CARRIER,
    );
    if (offers.length === 0) {
      throw new AppError("PROVIDER_UNAVAILABLE", "Duffel test mode returned no Duffel Airways offer for the demo route. Try reseeding.", {
        retrySafe: true,
        details: { op: "offer_requests.create", reason: "no_zz_offer", departureDate },
      });
    }
    offers.sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
    const chosen = offers[0];

    let fresh: OfferLite;
    try {
      fresh = (await this.duffel.offers.get(chosen.id)).data as unknown as OfferLite;
    } catch (err) {
      throw mapDuffelError(err, "offers.get", "OFFER_EXPIRED");
    }
    const passengerId = fresh.passengers?.[0]?.id;
    if (!passengerId) {
      throw new AppError("PROVIDER_UNAVAILABLE", "The selected offer had no passenger id.", { details: { op: "offers.get" } });
    }

    let created;
    try {
      created = await this.duffel.orders.create({
        type: "instant",
        selected_offers: [fresh.id],
        passengers: [{ id: passengerId, ...FICTIONAL_PASSENGER }],
        payments: [{ type: "balance", amount: fresh.total_amount, currency: fresh.total_currency }],
      });
    } catch (err) {
      throw mapDuffelError(err, "orders.create");
    }
    const order = await this.getOrder(created.data.id);
    log("duffel.order.created", { orderId: order.id, ms: Date.now() - started, changeAvailable: order.availableActions.includes("change") });
    return order;
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    try {
      const res = await withReadRetry(() => this.duffel.orders.get(orderId));
      return normalizeOrder(res.data as unknown as RawOrder);
    } catch (err) {
      throw mapDuffelError(err, "orders.get", "NO_DEMO_ORDER");
    }
  }

  /**
   * Duffel test mode creates a NEW simulated airline-initiated change every
   * time this list endpoint is called for an LHR→LTN Duffel Airways order.
   * The service layer guarantees it is called once per order. Never retried.
   */
  async simulateAirlineChange(orderId: string): Promise<ProviderAirlineChange> {
    try {
      const res = await this.duffel.airlineInitiatedChanges.list(orderId);
      const list = (res.data ?? []) as unknown as RawAirlineInitiatedChange[];
      if (list.length === 0) {
        throw new AppError("PROVIDER_UNAVAILABLE", "Duffel test mode did not produce a simulated airline change.", {
          details: { op: "airline_initiated_changes.list" },
        });
      }
      const newest = [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      log("duffel.aic.simulated", { orderId, changeId: newest.id, count: list.length });
      return normalizeAirlineChange(newest);
    } catch (err) {
      throw mapDuffelError(err, "airline_initiated_changes.list", "NO_DEMO_ORDER");
    }
  }

  async searchChangeOffers(params: ChangeSearchParams): Promise<{ requestId: string; offers: ProviderChangeOffer[] }> {
    const started = Date.now();
    try {
      const res = await this.duffel.orderChangeRequests.create({
        order_id: params.orderId,
        slices: {
          remove: [{ slice_id: params.removeSliceId }],
          add: [
            {
              origin: params.origin,
              destination: params.destination,
              departure_date: params.departureDate,
              cabin_class: params.cabinClass,
            },
          ],
        },
      });
      const data = res.data as unknown as { id: string; order_change_offers?: RawChangeOffer[] };
      let raw = data.order_change_offers ?? [];
      if (raw.length === 0) {
        // One bounded re-read: some airlines return offers slightly after creation.
        await new Promise((r) => setTimeout(r, 1500));
        const again = await this.duffel.orderChangeRequests.get(data.id);
        raw = ((again.data as unknown as { order_change_offers?: RawChangeOffer[] }).order_change_offers) ?? [];
      }
      log("duffel.change_request.created", { orderId: params.orderId, requestId: data.id, offers: raw.length, ms: Date.now() - started });
      return { requestId: data.id, offers: raw.map(normalizeChangeOffer) };
    } catch (err) {
      throw mapDuffelError(err, "order_change_requests.create", "TRIP_CHANGED");
    }
  }

  async getChangeOffer(offerId: string): Promise<ProviderChangeOffer> {
    try {
      const res = await withReadRetry(() => this.duffel.orderChangeOffers.get(offerId));
      return normalizeChangeOffer(res.data as unknown as RawChangeOffer);
    } catch (err) {
      throw mapDuffelError(err, "order_change_offers.get", "OFFER_EXPIRED");
    }
  }

  async createPendingChange(offerId: string): Promise<ProviderPendingChange> {
    try {
      const res = await this.duffel.orderChanges.create({ selected_order_change_offer: offerId });
      const pending = normalizeOrderChange(res.data as unknown as RawOrderChange);
      log("duffel.order_change.created", { changeId: pending.id, orderId: pending.orderId });
      return pending;
    } catch (err) {
      throw mapDuffelError(err, "order_changes.create", "OFFER_EXPIRED");
    }
  }

  async getPendingChange(changeId: string): Promise<ProviderPendingChange> {
    try {
      const res = await withReadRetry(() => this.duffel.orderChanges.get(changeId));
      return normalizeOrderChange(res.data as unknown as RawOrderChange);
    } catch (err) {
      throw mapDuffelError(err, "order_changes.get", "PREVIEW_EXPIRED");
    }
  }

  async confirmChange(changeId: string, payment: Money | null): Promise<ProviderPendingChange> {
    try {
      const res = await this.duffel.orderChanges.confirm(
        changeId,
        payment ? { payment: { type: "balance", amount: payment.amount, currency: payment.currency } } : {},
      );
      const confirmed = normalizeOrderChange(res.data as unknown as RawOrderChange);
      log("duffel.order_change.confirmed", { changeId, orderId: confirmed.orderId, paid: payment ? payment.amount : "0" });
      return confirmed;
    } catch (err) {
      throw mapDuffelError(err, "order_changes.confirm", "PREVIEW_EXPIRED");
    }
  }
}
