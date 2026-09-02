import { describe, expect, it } from "vitest";
import { itineraryKey, orderFingerprint, sameItinerary } from "@/lib/fingerprint";
import type { ProviderOrder } from "@/lib/providers/types";
import type { ItinerarySummary } from "@/lib/types";

function itin(overrides: Partial<ItinerarySummary["segments"][number]> = {}): ItinerarySummary {
  return {
    segments: [
      {
        origin: "LHR",
        destination: "LTN",
        departingAt: "2026-10-17T10:00:00+01:00",
        arrivingAt: "2026-10-17T11:05:00+01:00",
        carrierCode: "ZZ",
        flightNumber: "0101",
        ...overrides,
      },
    ],
    stops: 0,
  };
}

function order(patch: Partial<ProviderOrder> = {}, sliceId = "sli_1", itinerary = itin()): ProviderOrder {
  return {
    id: "ord_1",
    bookingReference: "ABC123",
    ownerCode: "ZZ",
    liveMode: false,
    availableActions: ["change"],
    slices: [{ id: sliceId, origin: "LHR", destination: "LTN", departureDate: "2026-10-17", itinerary }],
    airlineChanges: [],
    total: { amount: "64.00", currency: "GBP" },
    createdAt: "2026-09-01T00:00:00Z",
    ...patch,
  };
}

describe("orderFingerprint", () => {
  it("is stable for identical orders and looks like a short hex digest", () => {
    const a = orderFingerprint(order());
    const b = orderFingerprint(structuredClone(order()));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });

  it("ignores non-material fields (reference, total, timestamps, actions)", () => {
    const base = orderFingerprint(order());
    expect(orderFingerprint(order({ bookingReference: "ZZZ999", total: { amount: "1.00", currency: "EUR" }, createdAt: "2030-01-01T00:00:00Z", availableActions: [] }))).toBe(base);
  });

  it("changes when a segment time changes", () => {
    const base = orderFingerprint(order());
    expect(orderFingerprint(order({}, "sli_1", itin({ departingAt: "2026-10-17T15:30:00+01:00" })))).not.toBe(base);
    expect(orderFingerprint(order({}, "sli_1", itin({ arrivingAt: "2026-10-17T11:06:00+01:00" })))).not.toBe(base);
  });

  it("changes when a flight number changes", () => {
    expect(orderFingerprint(order({}, "sli_1", itin({ flightNumber: "0999" })))).not.toBe(orderFingerprint(order()));
  });

  it("changes when the slice id changes", () => {
    expect(orderFingerprint(order({}, "sli_2"))).not.toBe(orderFingerprint(order()));
  });

  it("changes when the order id changes", () => {
    expect(orderFingerprint(order({ id: "ord_2" }))).not.toBe(orderFingerprint(order()));
  });
});

describe("itineraryKey", () => {
  it("encodes carrier, flight, route and both instants per segment", () => {
    expect(itineraryKey(itin())).toBe("ZZ0101|LHR>LTN|2026-10-17T10:00:00+01:00|2026-10-17T11:05:00+01:00");
  });
});

describe("sameItinerary", () => {
  it("is true across equal instants expressed with different offsets", () => {
    const utc = itin({ departingAt: "2026-10-17T09:00:00Z", arrivingAt: "2026-10-17T10:05:00Z" });
    expect(sameItinerary(itin(), utc)).toBe(true);
  });

  it("is false when a flight number, airport, or instant differs", () => {
    expect(sameItinerary(itin(), itin({ flightNumber: "0102" }))).toBe(false);
    expect(sameItinerary(itin(), itin({ destination: "MAN" }))).toBe(false);
    expect(sameItinerary(itin(), itin({ departingAt: "2026-10-17T10:01:00+01:00" }))).toBe(false);
  });

  it("is false when the segment count differs", () => {
    const two: ItinerarySummary = { segments: [...itin().segments, ...itin().segments], stops: 1 };
    expect(sameItinerary(itin(), two)).toBe(false);
  });
});
