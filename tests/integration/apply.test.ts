import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { fixtureTestHooks } from "@/lib/providers/fixture";
import { apply, getTrip, search } from "@/lib/recovery/service";
import type { ApplyInput } from "@/lib/validation";
import { ctx, expectAppError, optionRecord, previewed, PROVIDER_ID_RE, searched } from "./helpers";

beforeEach(() => {
  fixtureTestHooks.reset();
});

function input(previewId: string, idempotencyKey = "idem_0000000001"): ApplyInput {
  return { previewId, idempotencyKey };
}

describe("apply", () => {
  it("confirms the staged change, verifies it, and updates the session", async () => {
    const { c, pv } = await previewed();
    const res = await apply(c, input(pv.previewId));

    expect(res.status).toBe("confirmed");
    expect(res.verified).toBe(true);
    expect(res.before).toEqual(pv.before);
    expect(res.after).toEqual(pv.after);
    expect(res.totalCost).toEqual(pv.totalCost);
    expect(res.sandbox).toBe(true);
    expect(Date.parse(res.confirmedAt)).not.toBeNaN();
    expect(Date.parse(res.verifiedAt)).not.toBeNaN();
    expect(JSON.stringify(res)).not.toMatch(PROVIDER_ID_RE);

    expect(c.session.tripStatus).toBe("changed");
    expect(c.session.preview?.consumed).toBe(true);
    expect(c.session.search).toBeUndefined();
    expect(c.session.applied).toMatchObject({ previewId: pv.previewId, idempotencyKey: "idem_0000000001" });
    expect(c.session.applied!.changeId).toMatch(/^ocg_/);
    expect(fixtureTestHooks.snapshot().confirmed).toBe(1);

    const state = await getTrip(c);
    expect(state.trip!.status).toBe("changed");
    expect(state.trip!.itinerary).toEqual(pv.after);
    expect(state.preview).toBeNull();
    expect(state.disruption!.status).toBe("resolved (changed)");
  });

  it("replays with the same idempotency key as already_confirmed without a second mutation", async () => {
    const { c, pv } = await previewed();
    const first = await apply(c, input(pv.previewId));
    const replay = await apply(c, input(pv.previewId));
    expect(replay.status).toBe("already_confirmed");
    expect(replay.after).toEqual(first.after);
    expect(replay.confirmedAt).toBe(first.confirmedAt);
    expect(replay.verified).toBe(true);
    expect(fixtureTestHooks.snapshot().confirmed).toBe(1);
  });

  it("replays with a DIFFERENT idempotency key as already_confirmed too", async () => {
    const { c, pv } = await previewed();
    await apply(c, input(pv.previewId, "idem_key_A00000"));
    const replay = await apply(c, input(pv.previewId, "idem_key_B00000"));
    expect(replay.status).toBe("already_confirmed");
    expect(fixtureTestHooks.snapshot().confirmed).toBe(1);
    expect((await getTrip(c)).trip!.itinerary).toEqual(pv.after);
  });

  it("replays through the applied record once the preview is gone from the session", async () => {
    const { c, pv } = await previewed();
    await apply(c, input(pv.previewId));
    c.session = { ...c.session, preview: undefined };
    const replay = await apply(c, input(pv.previewId));
    expect(replay.status).toBe("already_confirmed");
    expect(replay.verified).toBe(true);
    expect(fixtureTestHooks.snapshot().confirmed).toBe(1);
  });

  it("serializes two concurrent applies on one ctx into exactly one confirmation", async () => {
    const { c, pv } = await previewed();
    const settled = await Promise.allSettled([apply(c, input(pv.previewId, "idem_concurrent1")), apply(c, input(pv.previewId, "idem_concurrent2"))]);

    expect(fixtureTestHooks.snapshot().confirmed).toBe(1);
    const statuses = settled.map((s) => (s.status === "fulfilled" ? s.value.status : (s.reason as AppError).code));
    expect(statuses).toContain("confirmed");
    for (const s of statuses) expect(["confirmed", "already_confirmed", "ALREADY_CONFIRMED"]).toContain(s);
    expect(c.session.tripStatus).toBe("changed");
    expect(c.session.preview?.consumed).toBe(true);
    expect((await getTrip(c)).trip!.itinerary).toEqual(pv.after);
  });

  it("requires a seeded session", async () => {
    await expectAppError(apply(ctx(), input("prv_abc123XYZ")), "NO_DEMO_ORDER");
  });

  it("reports a missing preview", async () => {
    const { c } = await searched();
    const err = await expectAppError(apply(c, input("prv_abc123XYZ")), "PREVIEW_EXPIRED");
    expect(err.details?.reason).toBe("missing");
    expect(fixtureTestHooks.snapshot().confirmed).toBe(0);
  });

  it("refuses an expired pending change and clears the preview", async () => {
    const { c, pv } = await previewed();
    fixtureTestHooks.expirePending(c.session.preview!.changeId);
    await expectAppError(apply(c, input(pv.previewId)), "PREVIEW_EXPIRED");
    expect(c.session.preview).toBeUndefined();
    expect(c.session.applied).toBeUndefined();
    expect(fixtureTestHooks.snapshot().confirmed).toBe(0);
  });

  it("refuses an expired session preview record", async () => {
    const { c, pv } = await previewed();
    c.session = { ...c.session, preview: { ...c.session.preview!, expiresAt: new Date(Date.now() - 1000).toISOString() } };
    await expectAppError(apply(c, input(pv.previewId)), "PREVIEW_EXPIRED");
    expect(c.session.preview).toBeUndefined();
    expect(fixtureTestHooks.snapshot().confirmed).toBe(0);
  });

  it("refuses when the order changed underneath the preview and clears search + preview", async () => {
    const { c, pv } = await previewed();
    fixtureTestHooks.perturbOrder(c.session.orderId!);
    await expectAppError(apply(c, input(pv.previewId)), "TRIP_CHANGED");
    expect(c.session.preview).toBeUndefined();
    expect(c.session.search).toBeUndefined();
    expect(c.session.tripStatus).toBe("booked");
    expect(fixtureTestHooks.snapshot().confirmed).toBe(0);
  });

  it("refuses when the price moved since the preview", async () => {
    const { c, pv } = await previewed();
    fixtureTestHooks.repriceOffer(optionRecord(c, c.session.preview!.optionKey).offerId, "55.00");
    const err = await expectAppError(apply(c, input(pv.previewId)), "PREVIEW_EXPIRED");
    expect(err.details?.reason).toBe("price_changed");
    expect(c.session.preview).toBeUndefined();
    expect(fixtureTestHooks.snapshot().confirmed).toBe(0);
  });

  it("propagates a provider failure on confirm, keeps the preview, and lets a later apply succeed", async () => {
    const { c, pv } = await previewed();
    fixtureTestHooks.failNext("confirmChange", new AppError("PROVIDER_UNAVAILABLE", "down"));
    await expectAppError(apply(c, input(pv.previewId)), "PROVIDER_UNAVAILABLE");

    expect(fixtureTestHooks.snapshot().confirmed).toBe(0);
    expect(c.session.preview?.consumed).toBe(false);
    expect(c.session.applied).toBeUndefined();
    expect(c.session.tripStatus).toBe("booked");
    expect((await getTrip(c)).trip!.itinerary).toEqual(pv.before);

    const retry = await apply(c, input(pv.previewId));
    expect(retry.status).toBe("confirmed");
    expect(retry.verified).toBe(true);
    expect(fixtureTestHooks.snapshot().confirmed).toBe(1);
  });

  it("confirms a zero-cost change without a payment", async () => {
    const { c, pv } = await previewed();
    const rec = c.session.preview!;
    fixtureTestHooks.repriceOffer(optionRecord(c, rec.optionKey).offerId, "0.00");
    c.session = { ...c.session, preview: { ...rec, total: { ...rec.total, amount: "0.00" } } };

    let paymentSeen: unknown = "unset";
    const confirm = c.provider.confirmChange.bind(c.provider);
    c.provider.confirmChange = async (changeId, payment) => {
      paymentSeen = payment;
      return confirm(changeId, payment);
    };

    const res = await apply(c, input(pv.previewId));
    expect(res.status).toBe("confirmed");
    expect(res.verified).toBe(true);
    expect(res.totalCost.amount).toBe("0.00");
    expect(paymentSeen).toBeNull();
    expect(fixtureTestHooks.snapshot().confirmed).toBe(1);
  });

  it("pays exactly the staged total for a positive-cost change", async () => {
    const { c, pv } = await previewed();
    let paymentSeen: unknown = "unset";
    const confirm = c.provider.confirmChange.bind(c.provider);
    c.provider.confirmChange = async (changeId, payment) => {
      paymentSeen = payment;
      return confirm(changeId, payment);
    };
    await apply(c, input(pv.previewId));
    expect(paymentSeen).toEqual(pv.totalCost);
  });

  it("after applying, a new search is required before another preview", async () => {
    const { c, pv } = await previewed();
    await apply(c, input(pv.previewId));
    expect(c.session.search).toBeUndefined();
    const again = await search(c, {});
    expect(again.options.length).toBeGreaterThan(0);
    expect(c.session.search!.searchId).toBe(again.searchId);
  });
});
