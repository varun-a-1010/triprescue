import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { fixtureTestHooks } from "@/lib/providers/fixture";
import { disrupt, getTrip, search } from "@/lib/recovery/service";
import { ctx, expectAppError, localClock, seeded } from "./helpers";

beforeEach(() => {
  fixtureTestHooks.reset();
});

async function changeCount(c: Awaited<ReturnType<typeof seeded>>): Promise<number> {
  const order = await c.provider.getOrder(c.session.orderId!);
  return order.airlineChanges.length;
}

describe("disrupt", () => {
  it("requires a seeded session", async () => {
    await expectAppError(disrupt(ctx()), "NO_DEMO_ORDER");
  });

  it("reports no disruption before it is triggered", async () => {
    const c = await seeded();
    const state = await getTrip(c);
    expect(state.disruption).toBeNull();
    expect(state.trip!.status).toBe("booked");
    expect(localClock(state.trip!.itinerary.segments[0].departingAt)).toBe("10:00");
  });

  it("triggers exactly one simulated airline change and moves the itinerary", async () => {
    const c = await seeded();
    const before = (await getTrip(c)).trip!.itinerary;
    const res = await disrupt(c);

    expect(res.status).toBe("triggered");
    expect(res.disruption).not.toBeNull();
    expect(res.disruption!.kind).toBe("airline_schedule_change");
    expect(res.disruption!.message).toContain("Simulated");
    expect(res.disruption!.message).toContain("10:00");
    expect(res.disruption!.message).toContain("15:30");
    expect(res.disruption!.status).toBe("action required");
    expect(res.disruption!.previous).toEqual(before);
    expect(localClock(res.trip!.itinerary.segments[0].departingAt)).toBe("15:30");
    expect(res.trip!.itinerary).not.toEqual(before);
    expect(res.trip!.status).toBe("booked");
    expect(res.preview).toBeNull();

    expect(c.session.disruption?.changeId).toMatch(/^aic_/);
    expect(await changeCount(c)).toBe(1);
  });

  it("is idempotent on a sequential retry (already_triggered, still one change)", async () => {
    const c = await seeded();
    const first = await disrupt(c);
    const second = await disrupt(c);
    const third = await disrupt(c);

    expect(second.status).toBe("already_triggered");
    expect(third.status).toBe("already_triggered");
    expect(second.disruption).toEqual(first.disruption);
    expect(second.trip!.itinerary).toEqual(first.trip!.itinerary);
    expect(await changeCount(c)).toBe(1);
    expect(fixtureTestHooks.snapshot()).toMatchObject({ orders: 1, offers: 0, pending: 0, confirmed: 0 });
  });

  it("clears any earlier search from the session", async () => {
    const c = await seeded();
    await search(c, {});
    expect(c.session.search).toBeDefined();
    await disrupt(c);
    expect(c.session.search).toBeUndefined();
    expect(c.session.preview).toBeUndefined();
  });

  it("leaves the session untouched when the provider call fails", async () => {
    const c = await seeded();
    fixtureTestHooks.failNext("simulateAirlineChange", new AppError("PROVIDER_UNAVAILABLE", "down"));
    await expectAppError(disrupt(c), "PROVIDER_UNAVAILABLE");
    expect(c.session.disruption).toBeUndefined();
    expect(await changeCount(c)).toBe(0);
    // A retry then succeeds exactly once.
    expect((await disrupt(c)).status).toBe("triggered");
    expect(await changeCount(c)).toBe(1);
  });

  it("is exactly-once under concurrent calls on one session (per-order lock)", async () => {
    // The service serializes the mutating section per orderId and re-checks the
    // session inside the lock, so a burst of concurrent calls sharing one
    // session yields ONE simulated change: one "triggered", the rest
    // "already_triggered". (Across separate processes the cookie alone cannot
    // dedupe; the UI also disables the control while a call is in flight.)
    const c = await seeded();
    const results = await Promise.all(Array.from({ length: 5 }, () => disrupt(c)));

    expect(results.filter((r) => r.status === "triggered")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_triggered")).toHaveLength(4);
    const order = await c.provider.getOrder(c.session.orderId!);
    expect(order.airlineChanges).toHaveLength(1);
    expect(c.session.disruption).toBeDefined();
    expect(order.airlineChanges[0].id).toBe(c.session.disruption!.changeId);
    const state = await getTrip(c);
    expect(state.disruption).not.toBeNull();
    expect((await disrupt(c)).status).toBe("already_triggered");
  });
});
