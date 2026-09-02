import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { fixtureTestHooks } from "@/lib/providers/fixture";
import { arrivalOf } from "@/lib/recovery/rank";
import { MAX_UI_OPTIONS, SEARCH_TTL_MINUTES, search, seed } from "@/lib/recovery/service";
import { compareInstants, isBefore } from "@/lib/time";
import { ctx, disrupted, expectAppError, localClock, optionRecord, PROVIDER_ID_RE, searched } from "./helpers";

beforeEach(() => {
  fixtureTestHooks.reset();
});

describe("search", () => {
  it("requires a seeded session", async () => {
    await expectAppError(search(ctx(), {}), "NO_DEMO_ORDER");
  });

  it("searches against the CURRENT (post-disruption) slice, not the original booking", async () => {
    const c = await disrupted();
    const order = await c.provider.getOrder(c.session.orderId!);
    const change = order.airlineChanges[0];
    const current = order.slices[0].itinerary;
    expect(current).toEqual(change.added);
    expect(current).not.toEqual(change.removed);

    const result = await search(c, {});
    for (const option of [...result.options, ...result.ineligible]) {
      const offer = await c.provider.getChangeOffer(optionRecord(c, option.optionKey).offerId);
      expect(offer.remove).toEqual(current);
      expect(offer.remove).not.toEqual(change.removed);
      expect(localClock(offer.remove.segments[0].departingAt)).toBe("15:30");
    }
  });

  it("returns ranked, eligible options with sandbox marker and echoed constraints", async () => {
    const { result } = await searched();
    expect(result.searchId).toMatch(/^srch_[A-Za-z0-9]{6,32}$/);
    expect(result.currency).toBe("GBP");
    expect(result.sandbox).toBe(true);
    expect(result.constraints).toEqual({});
    expect(result.ineligible).toEqual([]);
    expect(result.options.length).toBeLessThanOrEqual(MAX_UI_OPTIONS);
    expect(result.options.map((o) => o.itinerary.segments[0].flightNumber)).toEqual(["0103", "0221", "0105", "0109"]);
    const arrivals = result.options.map((o) => arrivalOf(o.itinerary));
    for (let i = 1; i < arrivals.length; i += 1) expect(compareInstants(arrivals[i - 1], arrivals[i])).toBeLessThanOrEqual(0);
    for (const o of result.options) {
      expect(o.optionKey).toMatch(/^opt_[A-Za-z0-9]{6,32}$/);
      expect(o.eligible).toBe(true);
      expect(o.eligibilityReasons).toEqual([]);
      expect(o.totalCost.currency).toBe("GBP");
      expect(o.expiresAt).toBeTruthy();
    }
  });

  it("honours arriveBy, treating an arrival exactly at the deadline as eligible", async () => {
    const { c, result: open } = await searched();
    const arriveBy = arrivalOf(open.options[1].itinerary); // the second-earliest arrival
    const result = await search(c, { arriveBy });
    expect(result.constraints).toEqual({ arriveBy });
    expect(result.options.map((o) => arrivalOf(o.itinerary))).toEqual([arrivalOf(open.options[0].itinerary), arriveBy]);
    expect(result.options.every((o) => compareInstants(arrivalOf(o.itinerary), arriveBy) <= 0)).toBe(true);
    expect(result.ineligible).toHaveLength(2);
    for (const o of result.ineligible) {
      expect(o.eligible).toBe(false);
      expect(o.eligibilityReasons).toEqual([`arrives after ${arriveBy}`]);
    }
  });

  it("honours maxExtraAmount with an exact cap boundary", async () => {
    const { c, result: atCap } = await searched({ maxExtraAmount: "42.00" });
    expect(atCap.options.map((o) => o.totalCost.amount)).toEqual(["42.00", "25.00", "12.00"]);
    expect(atCap.ineligible.map((o) => o.totalCost.amount)).toEqual(["96.00"]);
    expect(atCap.ineligible[0].eligibilityReasons).toEqual(["costs 96.00 GBP, above the 42.00 limit"]);

    const belowCap = await search(c, { maxExtraAmount: "41.99" });
    expect(belowCap.options.map((o) => o.totalCost.amount)).toEqual(["25.00", "12.00"]);
    expect(belowCap.ineligible.map((o) => o.totalCost.amount)).toEqual(["42.00", "96.00"]);
  });

  it("honours maxStops", async () => {
    const { result } = await searched({ maxStops: 0 });
    expect(result.options.every((o) => o.itinerary.stops === 0)).toBe(true);
    expect(result.ineligible).toHaveLength(1);
    expect(result.ineligible[0].itinerary.stops).toBe(1);
    expect(result.ineligible[0].eligibilityReasons).toEqual(["1 stop, above the 0 limit"]);
  });

  it("explains every option when nothing satisfies the constraints", async () => {
    const { result } = await searched({ maxExtraAmount: "5.00", maxStops: 0 });
    expect(result.options).toEqual([]);
    expect(result.ineligible).toHaveLength(4);
    for (const o of result.ineligible) {
      expect(o.eligibilityReasons.length).toBeGreaterThan(0);
      expect(o.eligibilityReasons[0]).toMatch(/above the 5\.00 limit/);
    }
    expect(result.ineligible.find((o) => o.itinerary.stops === 1)!.eligibilityReasons).toHaveLength(2);
  });

  it("exposes no provider ids in the result", async () => {
    const { result } = await searched();
    const json = JSON.stringify(result);
    expect(json).not.toMatch(PROVIDER_ID_RE);
    expect(json).not.toContain("offerId");
  });

  it("expires no later than the earliest option and the search TTL", async () => {
    const { result } = await searched();
    const now = new Date();
    const ttlCeiling = new Date(now.getTime() + SEARCH_TTL_MINUTES * 60000 + 1000).toISOString();
    expect(isBefore(ttlCeiling, result.expiresAt)).toBe(false);
    for (const o of [...result.options, ...result.ineligible]) {
      expect(compareInstants(result.expiresAt, o.expiresAt)).toBeLessThanOrEqual(0);
    }
  });

  it("records only opaque keys → provider offer ids on the session", async () => {
    const { c, result } = await searched({ maxStops: 0 });
    const rec = c.session.search!;
    expect(rec.searchId).toBe(result.searchId);
    expect(rec.expiresAt).toBe(result.expiresAt);
    expect(rec.prefs).toEqual({ maxStops: 0 });
    expect(rec.currency).toBe("GBP");
    expect(rec.fingerprint).toMatch(/^[0-9a-f]{24}$/);
    const visible = [...result.options, ...result.ineligible];
    expect(Object.keys(rec.options).sort()).toEqual(visible.map((o) => o.optionKey).sort());
    for (const o of visible) {
      const r = rec.options[o.optionKey];
      expect(r.offerId).toMatch(/^oco_/);
      expect(r.total).toEqual(o.totalCost);
      expect(r.expiresAt).toBe(o.expiresAt);
    }
  });

  it("a new search replaces the previous record with fresh ids", async () => {
    const { c, result: first } = await searched();
    const second = await search(c, {});
    expect(second.searchId).not.toBe(first.searchId);
    expect(c.session.search!.searchId).toBe(second.searchId);
    expect(c.session.search!.options[first.options[0].optionKey]).toBeUndefined();
  });

  it("throws NO_RECOVERY_OPTIONS when the provider returns zero offers", async () => {
    const c = await disrupted();
    c.provider.searchChangeOffers = async () => ({ requestId: "ocr_none", offers: [] });
    await expectAppError(search(c, {}), "NO_RECOVERY_OPTIONS");
    expect(c.session.search).toBeUndefined();
  });

  it("propagates a provider failure and leaves the session unchanged", async () => {
    const c = await disrupted();
    fixtureTestHooks.failNext("searchChangeOffers", new AppError("NO_RECOVERY_OPTIONS", "none"));
    await expectAppError(search(c, {}), "NO_RECOVERY_OPTIONS");
    expect(c.session.search).toBeUndefined();
  });

  it("refuses when the order no longer allows changes", async () => {
    const c = ctx();
    await seed(c, {});
    const getOrder = c.provider.getOrder.bind(c.provider);
    c.provider.getOrder = async (id) => ({ ...(await getOrder(id)), availableActions: ["cancel"] });
    await expectAppError(search(c, {}), "ORDER_NOT_CHANGEABLE");
  });
});
