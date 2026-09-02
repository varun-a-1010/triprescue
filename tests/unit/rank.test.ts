import { describe, expect, it } from "vitest";
import type { ProviderChangeOffer } from "@/lib/providers/types";
import type { ItinerarySummary, RecoveryOption, SegmentSummary } from "@/lib/types";
import { arrivalOf, evaluateEligibility, partitionOptions, rankOptions, toRecoveryOption } from "@/lib/recovery/rank";

const DAY = "2026-10-17";

function seg(origin: string, destination: string, dep: string, arr: string, flightNumber: string, offset = "+01:00"): SegmentSummary {
  return {
    origin,
    destination,
    departingAt: `${DAY}T${dep}:00${offset}`,
    arrivingAt: `${DAY}T${arr}:00${offset}`,
    carrierCode: "ZZ",
    flightNumber,
  };
}

function itin(...segments: SegmentSummary[]): ItinerarySummary {
  return { segments, stops: Math.max(0, segments.length - 1) };
}

function offer(id: string, add: ItinerarySummary, changeTotal: string, penalty = "20.00"): ProviderChangeOffer {
  return {
    id,
    expiresAt: `${DAY}T09:00:00Z`,
    changeTotal: { amount: changeTotal, currency: "GBP" },
    penalty: { amount: penalty, currency: "GBP" },
    newTotal: { amount: "64.00", currency: "GBP" },
    add,
    remove: itin(seg("LHR", "LTN", "10:00", "11:05", "0101")),
  };
}

const direct1305 = offer("oco_a", itin(seg("LHR", "LTN", "12:00", "13:05", "0103")), "42.00");
const direct1535 = offer("oco_b", itin(seg("LHR", "LTN", "14:30", "15:35", "0105")), "25.00");
const viaMan1405 = offer("oco_c", itin(seg("LHR", "MAN", "11:00", "12:10", "0221"), seg("MAN", "LTN", "13:00", "14:05", "0222")), "96.00");
const direct2005 = offer("oco_d", itin(seg("LHR", "LTN", "19:00", "20:05", "0109")), "12.00");

function options(prefs = {}, offers = [direct1535, direct1305, viaMan1405, direct2005]): RecoveryOption[] {
  return offers.map((o, i) => toRecoveryOption(o, `opt_${i}`, prefs));
}

describe("arrivalOf", () => {
  it("is the arrival of the last segment", () => {
    expect(arrivalOf(viaMan1405.add)).toBe(`${DAY}T14:05:00+01:00`);
  });
});

describe("toRecoveryOption", () => {
  it("derives fareDelta = total - penalty and carries the offer itinerary and expiry", () => {
    const o = toRecoveryOption(direct1305, "opt_x", {});
    expect(o.optionKey).toBe("opt_x");
    expect(o.itinerary).toEqual(direct1305.add);
    expect(o.totalCost).toEqual({ amount: "42.00", currency: "GBP" });
    expect(o.penalty).toEqual({ amount: "20.00", currency: "GBP" });
    expect(o.fareDelta).toEqual({ amount: "22.00", currency: "GBP" });
    expect(o.expiresAt).toBe(direct1305.expiresAt);
    expect(o.eligible).toBe(true);
    expect(o.eligibilityReasons).toEqual([]);
  });

  it("allows a negative fare delta when the penalty exceeds the change total", () => {
    expect(toRecoveryOption(direct2005, "opt_x", {}).fareDelta.amount).toBe("-8.00");
  });
});

describe("rankOptions", () => {
  it("ranks by earliest arrival first", () => {
    const ranked = rankOptions(options());
    expect(ranked.map((o) => o.itinerary.segments[0].flightNumber)).toEqual(["0103", "0221", "0105", "0109"]);
  });

  it("breaks an arrival tie by lowest total change cost", () => {
    const pricey = offer("oco_p", itin(seg("LHR", "LTN", "12:00", "13:05", "0301")), "42.00");
    const cheap = offer("oco_q", itin(seg("LHR", "LTN", "12:10", "13:05", "0302")), "30.00");
    const ranked = rankOptions([toRecoveryOption(pricey, "opt_p", {}), toRecoveryOption(cheap, "opt_q", {})]);
    expect(ranked.map((o) => o.optionKey)).toEqual(["opt_q", "opt_p"]);
  });

  it("breaks an arrival + cost tie by fewest stops", () => {
    const oneStop = offer("oco_s", itin(seg("LHR", "MAN", "10:00", "11:00", "0401"), seg("MAN", "LTN", "12:00", "13:05", "0402")), "30.00");
    const nonStop = offer("oco_n", itin(seg("LHR", "LTN", "12:00", "13:05", "0403")), "30.00");
    const ranked = rankOptions([toRecoveryOption(oneStop, "opt_s", {}), toRecoveryOption(nonStop, "opt_n", {})]);
    expect(ranked.map((o) => o.optionKey)).toEqual(["opt_n", "opt_s"]);
  });

  it("compares arrivals as instants across offsets", () => {
    // 13:05+01:00 is 12:05Z; 12:30Z arrives later even though "12:30" < "13:05" as text.
    const a = offer("oco_a", itin(seg("LHR", "LTN", "12:00", "13:05", "0501", "+01:00")), "10.00");
    const b = offer("oco_b", itin(seg("LHR", "LTN", "11:00", "12:30", "0502", "Z")), "10.00");
    const ranked = rankOptions([toRecoveryOption(b, "opt_b", {}), toRecoveryOption(a, "opt_a", {})]);
    expect(ranked.map((o) => o.optionKey)).toEqual(["opt_a", "opt_b"]);
  });

  it("does not mutate its input", () => {
    const input = options();
    const before = input.map((o) => o.optionKey);
    rankOptions(input);
    expect(input.map((o) => o.optionKey)).toEqual(before);
  });
});

describe("evaluateEligibility", () => {
  const total = { amount: "80.00", currency: "GBP" };

  it("is eligible with no constraints", () => {
    expect(evaluateEligibility(direct1305.add, total, {})).toEqual({ eligible: true, reasons: [] });
  });

  it("treats arriving exactly at arriveBy as eligible", () => {
    expect(evaluateEligibility(direct1305.add, total, { arriveBy: `${DAY}T13:05:00+01:00` }).eligible).toBe(true);
    // Same instant expressed in UTC
    expect(evaluateEligibility(direct1305.add, total, { arriveBy: `${DAY}T12:05:00Z` }).eligible).toBe(true);
  });

  it("names the arrival constraint when arriving one minute late", () => {
    const verdict = evaluateEligibility(direct1305.add, total, { arriveBy: `${DAY}T13:04:00+01:00` });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons).toEqual([`arrives after ${DAY}T13:04:00+01:00`]);
  });

  it("treats cost exactly at the cap as eligible and one penny over as ineligible", () => {
    expect(evaluateEligibility(direct1305.add, total, { maxExtraAmount: "80.00" }).eligible).toBe(true);
    expect(evaluateEligibility(direct1305.add, total, { maxExtraAmount: "80" }).eligible).toBe(true);
    const verdict = evaluateEligibility(direct1305.add, total, { maxExtraAmount: "79.99" });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons).toEqual(["costs 80.00 GBP, above the 79.99 limit"]);
  });

  it("names the stop constraint with correct pluralisation", () => {
    expect(evaluateEligibility(viaMan1405.add, total, { maxStops: 1 }).eligible).toBe(true);
    expect(evaluateEligibility(viaMan1405.add, total, { maxStops: 0 }).reasons).toEqual(["1 stop, above the 0 limit"]);
    const twoStops = itin(seg("LHR", "MAN", "08:00", "09:00", "1"), seg("MAN", "EDI", "10:00", "11:00", "2"), seg("EDI", "LTN", "12:00", "13:00", "3"));
    expect(evaluateEligibility(twoStops, total, { maxStops: 1 }).reasons).toEqual(["2 stops, above the 1 limit"]);
  });

  it("reports every failing constraint, in filter order", () => {
    const verdict = evaluateEligibility(viaMan1405.add, { amount: "96.00", currency: "GBP" }, {
      arriveBy: `${DAY}T13:00:00+01:00`,
      maxExtraAmount: "50.00",
      maxStops: 0,
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons).toHaveLength(3);
    expect(verdict.reasons[0]).toMatch(/^arrives after/);
    expect(verdict.reasons[1]).toMatch(/^costs 96\.00 GBP/);
    expect(verdict.reasons[2]).toMatch(/^1 stop/);
  });
});

describe("partitionOptions", () => {
  it("splits into eligible and ineligible, both ranked", () => {
    const prefs = { maxExtraAmount: "42.00", maxStops: 0 };
    const { eligible, ineligible } = partitionOptions(options(prefs));
    expect(eligible.map((o) => o.totalCost.amount)).toEqual(["42.00", "25.00", "12.00"]);
    expect(eligible.every((o) => o.eligible && o.eligibilityReasons.length === 0)).toBe(true);
    expect(ineligible).toHaveLength(1);
    expect(ineligible[0].itinerary.stops).toBe(1);
    expect(ineligible[0].eligibilityReasons).toEqual(["costs 96.00 GBP, above the 42.00 limit", "1 stop, above the 0 limit"]);
  });

  it("keeps ranking within the ineligible list too", () => {
    const { eligible, ineligible } = partitionOptions(options({ maxExtraAmount: "0.00" }));
    expect(eligible).toEqual([]);
    expect(ineligible.map((o) => arrivalOf(o.itinerary))).toEqual([
      `${DAY}T13:05:00+01:00`,
      `${DAY}T14:05:00+01:00`,
      `${DAY}T15:35:00+01:00`,
      `${DAY}T20:05:00+01:00`,
    ]);
  });
});
