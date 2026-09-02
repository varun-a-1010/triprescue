import { beforeEach, describe, expect, it } from "vitest";
import { fixtureTestHooks } from "@/lib/providers/fixture";
import { apply, status } from "@/lib/recovery/service";
import { ctx, disrupted, expectAppError, previewed, PROVIDER_ID_RE, seeded } from "./helpers";

beforeEach(() => {
  fixtureTestHooks.reset();
});

describe("status", () => {
  it("requires a seeded session", async () => {
    await expectAppError(status(ctx()), "NO_DEMO_ORDER");
  });

  it("reports nothing applied on a fresh booking", async () => {
    const c = await seeded();
    const res = await status(c);
    expect(res.verification).toMatchObject({ applied: false, verified: false, confirmedAt: null, intended: null });
    expect(Date.parse(res.verification.verifiedAt)).not.toBeNaN();
    expect(res.trip!.status).toBe("booked");
    expect(res.disruption).toBeNull();
    expect(res.preview).toBeNull();
  });

  it("reports the disruption and the active preview before apply", async () => {
    const c = await disrupted();
    expect((await status(c)).disruption).not.toBeNull();

    const { c: c2, pv } = await previewed();
    const res = await status(c2);
    expect(res.verification.applied).toBe(false);
    expect(res.verification.verified).toBe(false);
    expect(res.verification.intended).toBeNull();
    expect(res.preview?.previewId).toBe(pv.previewId);
    expect(res.preview?.after).toEqual(pv.after);
    expect(res.trip!.status).toBe("booked");
    expect(res.trip!.itinerary).toEqual(pv.before);
  });

  it("reports applied + verified with the intended itinerary after apply", async () => {
    const { c, pv } = await previewed();
    const result = await apply(c, { previewId: pv.previewId, idempotencyKey: "idem_status00001" });
    const res = await status(c);

    expect(res.verification.applied).toBe(true);
    expect(res.verification.verified).toBe(true);
    expect(res.verification.intended).toEqual(pv.after);
    expect(res.verification.confirmedAt).toBe(result.confirmedAt);
    expect(res.trip!.status).toBe("changed");
    expect(res.trip!.itinerary).toEqual(pv.after);
    expect(res.preview).toBeNull();
    expect(res.disruption!.status).toBe("resolved (changed)");
    expect(JSON.stringify(res.verification)).not.toMatch(PROVIDER_ID_RE);
  });

  it("reports applied but NOT verified when the provider order drifts from the intended itinerary", async () => {
    const { c, pv } = await previewed();
    await apply(c, { previewId: pv.previewId, idempotencyKey: "idem_status00002" });
    fixtureTestHooks.perturbOrder(c.session.orderId!);
    const res = await status(c);
    expect(res.verification.applied).toBe(true);
    expect(res.verification.verified).toBe(false);
    expect(res.verification.intended).toEqual(pv.after);
    expect(res.trip!.itinerary).not.toEqual(pv.after);
  });
});
