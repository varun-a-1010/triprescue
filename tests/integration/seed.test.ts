import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { fixtureTestHooks } from "@/lib/providers/fixture";
import { disrupt, getTrip, search, seed } from "@/lib/recovery/service";
import { ctx, expectAppError } from "./helpers";

beforeEach(() => {
  fixtureTestHooks.reset();
});

describe("seed", () => {
  it("creates a changeable sandbox order and records it on the session", async () => {
    const c = ctx();
    const res = await seed(c, {});
    expect(res.status).toBe("created");
    expect(res.trip).not.toBeNull();
    expect(res.trip!.providerOrderId).toMatch(/^ord_/);
    expect(res.trip!.tripId).toMatch(/^trp_[0-9a-f]{12}$/);
    expect(res.trip!.changeAvailable).toBe(true);
    expect(res.trip!.status).toBe("booked");
    expect(res.trip!.sandbox).toBe(true);
    expect(res.trip!.providerMode).toBe("fixture");
    expect(res.trip!.itinerary.segments).toHaveLength(1);
    expect(res.disruption).toBeNull();
    expect(res.preview).toBeNull();
    expect(c.session.orderId).toBe(res.trip!.providerOrderId);
    expect(c.session.tripStatus).toBe("booked");
    expect(fixtureTestHooks.snapshot().orders).toBe(1);
  });

  it("returns the existing order on a second seed for the same session", async () => {
    const c = ctx();
    const first = await seed(c, {});
    const second = await seed(c, {});
    expect(second.status).toBe("existing");
    expect(second.trip!.providerOrderId).toBe(first.trip!.providerOrderId);
    expect(fixtureTestHooks.snapshot().orders).toBe(1);
  });

  it("forceNew creates a different order and resets session progress", async () => {
    const c = ctx();
    const first = await seed(c, {});
    await disrupt(c);
    await search(c, {});
    expect(c.session.disruption).toBeDefined();
    expect(c.session.search).toBeDefined();

    const fresh = await seed(c, { forceNew: true });
    expect(fresh.status).toBe("created");
    expect(fresh.trip!.providerOrderId).not.toBe(first.trip!.providerOrderId);
    expect(fresh.disruption).toBeNull();
    expect(c.session.orderId).toBe(fresh.trip!.providerOrderId);
    expect(c.session.disruption).toBeUndefined();
    expect(c.session.search).toBeUndefined();
    expect(c.session.tripStatus).toBe("booked");
    expect(fixtureTestHooks.snapshot().orders).toBe(2);
  });

  it("transparently reseeds when the provider no longer knows the session's order", async () => {
    const c = ctx();
    await seed(c, {});
    await disrupt(c);
    const sid = c.session.sid;

    fixtureTestHooks.reset(); // simulates the fixture store (or sandbox) losing the order
    const res = await seed(c, {});
    expect(res.status).toBe("created");
    expect(res.disruption).toBeNull();
    expect(c.session.sid).toBe(sid);
    expect(c.session.orderId).toBe(res.trip!.providerOrderId);
    expect(c.session.disruption).toBeUndefined();
    expect(fixtureTestHooks.snapshot().orders).toBe(1);
  });

  it("refuses an order the provider will not let us change", async () => {
    const c = ctx();
    const create = c.provider.createDemoOrder.bind(c.provider);
    c.provider.createDemoOrder = async (input) => {
      const order = await create(input);
      return { ...order, availableActions: ["cancel"] };
    };
    const err = await expectAppError(seed(c, {}), "ORDER_NOT_CHANGEABLE");
    expect(err.details?.providerOrderId).toMatch(/^ord_/);
    expect(c.session.orderId).toBeUndefined();
  });

  it("propagates provider failures without touching the session", async () => {
    const c = ctx();
    fixtureTestHooks.failNext("createDemoOrder", new AppError("PROVIDER_UNAVAILABLE", "down"));
    await expectAppError(seed(c, {}), "PROVIDER_UNAVAILABLE");
    expect(c.session.orderId).toBeUndefined();
    // The hook is one-shot: the next seed works.
    expect((await seed(c, {})).status).toBe("created");
  });
});

describe("getTrip", () => {
  it("requires a seeded session", async () => {
    await expectAppError(getTrip(ctx()), "NO_DEMO_ORDER");
  });

  it("reflects the seeded order", async () => {
    const c = ctx();
    const seededRes = await seed(c, {});
    const state = await getTrip(c);
    expect(state.trip).toEqual(seededRes.trip);
    expect(state.disruption).toBeNull();
    expect(state.preview).toBeNull();
  });
});
