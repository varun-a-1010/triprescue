import { describe, expect, it } from "vitest";
import {
  normalizeChangeOffer,
  normalizeOrder,
  normalizeOrderChange,
  type RawChangeOffer,
  type RawOrder,
  type RawOrderChange,
  type RawSlice,
} from "@/lib/duffel/normalize";

const LHR = { iata_code: "LHR", time_zone: "Europe/London", name: "Heathrow" };
const JFK = { iata_code: "JFK", time_zone: "America/New_York", name: "JFK" };
const NO_TZ = { iata_code: "XXX", time_zone: null };

function rawSlice(id: string, patch: Partial<RawSlice> = {}): RawSlice {
  return {
    id,
    origin: LHR,
    destination: JFK,
    segments: [
      {
        id: `seg_${id}`,
        origin: LHR,
        destination: JFK,
        departing_at: "2026-10-17T10:00:00",
        arriving_at: "2026-10-17T13:00:00",
        marketing_carrier: { iata_code: "ZZ" },
        marketing_carrier_flight_number: "0101",
        operating_carrier: { iata_code: "YY" },
        operating_carrier_flight_number: "9901",
      },
    ],
    ...patch,
  };
}

const PASSENGER_STRINGS = ["passenger", "given_name", "family_name", "Ada", "Lovelace", "email", "ada@example.com", "phone_number", "+441234567890", "born_on", "1990-01-01"];

/** A Duffel-shaped order that deliberately carries passenger PII and other noise. */
const rawOrder = {
  id: "ord_0000Abc",
  booking_reference: "PNR123",
  owner: { iata_code: "ZZ", name: "Zed Air" },
  live_mode: false,
  available_actions: ["cancel", "change", "update"],
  slices: [rawSlice("sli_1")],
  airline_initiated_changes: [
    {
      id: "aic_1",
      created_at: "2026-09-01T12:00:00Z",
      action_taken: null,
      available_actions: ["accept", "change"],
      added: [rawSlice("sli_added", { segments: [{ ...rawSlice("x").segments[0], departing_at: "2026-10-17T15:30:00", arriving_at: "2026-10-17T18:30:00" }] })],
      removed: [rawSlice("sli_1")],
    },
  ],
  total_amount: "64",
  total_currency: "GBP",
  created_at: "2026-08-30T00:00:00Z",
  passengers: [
    {
      id: "pas_1",
      given_name: "Ada",
      family_name: "Lovelace",
      email: "ada@example.com",
      phone_number: "+441234567890",
      born_on: "1990-01-01",
    },
  ],
  payment_status: { paid_at: "2026-08-30T00:00:00Z" },
};
// Deliberately not annotated: a fresh literal typed as RawOrder would be
// excess-property-checked, and the PII/noise keys are the point of this fixture.
// normalizeOrder(rawOrder) below still checks the material shape structurally.

describe("normalizeOrder", () => {
  it("drops passenger fields and any other provider noise", () => {
    const json = JSON.stringify(normalizeOrder(rawOrder));
    for (const s of PASSENGER_STRINGS) expect(json, s).not.toContain(s);
    expect(json).not.toContain("payment_status");
    expect(json).not.toContain("Zed Air");
  });

  it("maps the material fields", () => {
    const order = normalizeOrder(rawOrder);
    expect(order.id).toBe("ord_0000Abc");
    expect(order.bookingReference).toBe("PNR123");
    expect(order.ownerCode).toBe("ZZ");
    expect(order.liveMode).toBe(false);
    expect(order.availableActions).toEqual(["cancel", "change", "update"]);
    expect(order.total).toEqual({ amount: "64.00", currency: "GBP" });
    expect(order.createdAt).toBe("2026-08-30T00:00:00Z");
  });

  it("attaches offsets from each airport's time_zone", () => {
    const seg = normalizeOrder(rawOrder).slices[0].itinerary.segments[0];
    expect(seg.departingAt).toBe("2026-10-17T10:00:00+01:00");
    expect(seg.arrivingAt).toBe("2026-10-17T13:00:00-04:00");
    expect(seg.carrierCode).toBe("ZZ");
    expect(seg.flightNumber).toBe("0101");
    expect(seg.origin).toBe("LHR");
    expect(seg.destination).toBe("JFK");
  });

  it("derives slice route, local departure date and stop count", () => {
    const slice = normalizeOrder(rawOrder).slices[0];
    expect(slice.id).toBe("sli_1");
    expect(slice.origin).toBe("LHR");
    expect(slice.destination).toBe("JFK");
    expect(slice.departureDate).toBe("2026-10-17");
    expect(slice.itinerary.stops).toBe(0);
  });

  it("falls back to UTC when an airport has no time_zone", () => {
    const raw: RawOrder = {
      ...rawOrder,
      slices: [rawSlice("sli_u", { origin: NO_TZ, segments: [{ ...rawSlice("x").segments[0], origin: NO_TZ, destination: { iata_code: "YYY" } }] })],
      airline_initiated_changes: null,
    };
    const seg = normalizeOrder(raw).slices[0].itinerary.segments[0];
    expect(seg.departingAt).toBe("2026-10-17T10:00:00+00:00");
    expect(seg.arrivingAt).toBe("2026-10-17T13:00:00+00:00");
  });

  it("falls back to the operating carrier when the marketing carrier is absent", () => {
    const raw: RawOrder = {
      ...rawOrder,
      slices: [rawSlice("sli_o", { segments: [{ ...rawSlice("x").segments[0], marketing_carrier: null, marketing_carrier_flight_number: null }] })],
    };
    const seg = normalizeOrder(raw).slices[0].itinerary.segments[0];
    expect(seg.carrierCode).toBe("YY");
    expect(seg.flightNumber).toBe("9901");
  });

  it("normalizes airline-initiated changes with added/removed itineraries", () => {
    const change = normalizeOrder(rawOrder).airlineChanges[0];
    expect(change.id).toBe("aic_1");
    expect(change.createdAt).toBe("2026-09-01T12:00:00Z");
    expect(change.actionTaken).toBeNull();
    expect(change.availableActions).toEqual(["accept", "change"]);
    expect(change.removed.segments[0].departingAt).toBe("2026-10-17T10:00:00+01:00");
    expect(change.added.segments[0].departingAt).toBe("2026-10-17T15:30:00+01:00");
  });

  it("tolerates null collections", () => {
    const order = normalizeOrder({ ...rawOrder, available_actions: null, airline_initiated_changes: null, owner: null });
    expect(order.availableActions).toEqual([]);
    expect(order.airlineChanges).toEqual([]);
    expect(order.ownerCode).toBeNull();
  });
});

const rawOffer: RawChangeOffer = {
  id: "oco_1",
  expires_at: "2026-09-02T12:00:00Z",
  change_total_amount: "42.5",
  change_total_currency: "GBP",
  penalty_total_amount: "20",
  penalty_total_currency: "GBP",
  new_total_amount: "106.5",
  new_total_currency: "GBP",
  slices: { add: [rawSlice("sli_add")], remove: [rawSlice("sli_rm")] },
};

describe("normalizeChangeOffer", () => {
  it("normalizes amounts to two decimals and both itineraries", () => {
    const offer = normalizeChangeOffer(rawOffer);
    expect(offer.id).toBe("oco_1");
    expect(offer.expiresAt).toBe("2026-09-02T12:00:00Z");
    expect(offer.changeTotal).toEqual({ amount: "42.50", currency: "GBP" });
    expect(offer.penalty).toEqual({ amount: "20.00", currency: "GBP" });
    expect(offer.newTotal).toEqual({ amount: "106.50", currency: "GBP" });
    expect(offer.add.segments).toHaveLength(1);
    expect(offer.remove.segments).toHaveLength(1);
    expect(offer.add.segments[0].departingAt).toBe("2026-10-17T10:00:00+01:00");
  });

  it("treats a null change_total_amount as 0.00 and borrows the new_total currency", () => {
    const offer = normalizeChangeOffer({ ...rawOffer, change_total_amount: null, change_total_currency: null, new_total_currency: "EUR" });
    expect(offer.changeTotal).toEqual({ amount: "0.00", currency: "EUR" });
  });

  it("prefers penalty_amount, then penalty_total_amount, then 0.00", () => {
    expect(normalizeChangeOffer({ ...rawOffer, penalty_amount: "5", penalty_currency: "GBP" }).penalty.amount).toBe("5.00");
    expect(normalizeChangeOffer({ ...rawOffer, penalty_amount: null }).penalty.amount).toBe("20.00");
    expect(normalizeChangeOffer({ ...rawOffer, penalty_total_amount: null, penalty_total_currency: null }).penalty).toEqual({ amount: "0.00", currency: "GBP" });
  });

  it("defaults to GBP when no currency is present at all", () => {
    const offer = normalizeChangeOffer({ ...rawOffer, change_total_amount: null, change_total_currency: null, new_total_amount: null, new_total_currency: null });
    expect(offer.changeTotal).toEqual({ amount: "0.00", currency: "GBP" });
    expect(offer.newTotal).toEqual({ amount: "0.00", currency: "GBP" });
  });
});

describe("normalizeOrderChange", () => {
  const rawChange: RawOrderChange = { ...rawOffer, id: "ocg_1", order_id: "ord_0000Abc", confirmed_at: "2026-09-02T11:00:00Z" };

  it("carries order_id and confirmed_at alongside the offer fields", () => {
    const pending = normalizeOrderChange(rawChange);
    expect(pending.id).toBe("ocg_1");
    expect(pending.orderId).toBe("ord_0000Abc");
    expect(pending.confirmedAt).toBe("2026-09-02T11:00:00Z");
    expect(pending.expiresAt).toBe(rawOffer.expires_at);
    expect(pending.changeTotal.amount).toBe("42.50");
    expect(pending.add.segments[0].flightNumber).toBe("0101");
  });

  it("keeps confirmed_at null while unconfirmed", () => {
    expect(normalizeOrderChange({ ...rawChange, confirmed_at: null }).confirmedAt).toBeNull();
  });
});
