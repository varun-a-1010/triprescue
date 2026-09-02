import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { fixtureTestHooks } from "@/lib/providers/fixture";
import { apply, getTrip, preview, PREVIEW_TTL_MINUTES, search } from "@/lib/recovery/service";
import { newSession, opaqueId } from "@/lib/session";
import { compareInstants, isBefore } from "@/lib/time";
import { ctx, expectAppError, optionRecord, previewed, PROVIDER_ID_RE, searched } from "./helpers";

beforeEach(() => {
  fixtureTestHooks.reset();
});

describe("preview", () => {
  it("stages the chosen option and returns exact before/after and totals", async () => {
    const { c, result, pv } = await previewed();
    const option = result.options[0];
    const current = (await getTrip(c)).trip!.itinerary;

    expect(pv.previewId).toMatch(/^prv_[A-Za-z0-9]{6,32}$/);
    expect(pv.before).toEqual(current);
    expect(pv.after).toEqual(option.itinerary);
    expect(pv.totalCost).toEqual(option.totalCost);
    expect(pv.penalty).toEqual(option.penalty);
    expect(pv.fareDelta).toEqual(option.fareDelta);
    expect(pv.sandbox).toBe(true);
    expect(compareInstants(pv.expiresAt, option.expiresAt)).toBeLessThanOrEqual(0);
    const ttlCeiling = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60000 + 1000).toISOString();
    expect(isBefore(ttlCeiling, pv.expiresAt)).toBe(false);
    expect(JSON.stringify(pv)).not.toMatch(PROVIDER_ID_RE);

    const rec = c.session.preview!;
    expect(rec.previewId).toBe(pv.previewId);
    expect(rec.searchId).toBe(result.searchId);
    expect(rec.optionKey).toBe(option.optionKey);
    expect(rec.changeId).toMatch(/^ocg_/);
    expect(rec.fingerprint).toBe(c.session.search!.fingerprint);
    expect(rec.total).toEqual(option.totalCost);
    expect(rec.consumed).toBe(false);
    expect(rec.expiresAt).toBe(pv.expiresAt);
    expect(fixtureTestHooks.snapshot().pending).toBe(1);
    expect((await getTrip(c)).preview?.previewId).toBe(pv.previewId);
  });

  it("requires a seeded session", async () => {
    await expectAppError(preview(ctx(), { searchId: "srch_abc123XYZ", optionKey: "opt_abc123XYZ" }), "NO_DEMO_ORDER");
  });

  it("rejects an unknown searchId", async () => {
    const { c, result } = await searched();
    await expectAppError(preview(c, { searchId: opaqueId("srch"), optionKey: result.options[0].optionKey }), "OPTION_NOT_IN_PREVIEW");
    expect(c.session.preview).toBeUndefined();
  });

  it("rejects an optionKey that belongs to a previous search", async () => {
    const { c, result: first } = await searched();
    const second = await search(c, {});
    await expectAppError(preview(c, { searchId: second.searchId, optionKey: first.options[0].optionKey }), "OPTION_NOT_IN_PREVIEW");
    await expectAppError(preview(c, { searchId: first.searchId, optionKey: first.options[0].optionKey }), "OPTION_NOT_IN_PREVIEW");
    expect(fixtureTestHooks.snapshot().pending).toBe(0);
  });

  it("rejects an option that was listed as ineligible", async () => {
    const { c, result } = await searched({ maxStops: 0 });
    const err = await expectAppError(preview(c, { searchId: result.searchId, optionKey: result.ineligible[0].optionKey }), "OPTION_NOT_IN_PREVIEW");
    expect(err.details?.reason).toBe("ineligible");
    expect(err.message).toContain("1 stop, above the 0 limit");
    expect(fixtureTestHooks.snapshot().pending).toBe(0);
  });

  it("a different session cannot use another session's search ids", async () => {
    const { c, result } = await searched();
    const other = ctx({ ...newSession(), orderId: c.session.orderId, tripStatus: "booked" });
    await expectAppError(preview(other, { searchId: result.searchId, optionKey: result.options[0].optionKey }), "OPTION_NOT_IN_PREVIEW");
    expect(fixtureTestHooks.snapshot().pending).toBe(0);

    // Ownership is keyed by the session's own search record, not by the id strings:
    // a session that genuinely holds the record can stage the option.
    const owner = ctx({ ...newSession(), orderId: c.session.orderId, tripStatus: "booked", search: c.session.search });
    const pv = await preview(owner, { searchId: result.searchId, optionKey: result.options[0].optionKey });
    expect(pv.after).toEqual(result.options[0].itinerary);
  });

  it("rejects an expired offer", async () => {
    const { c, result } = await searched();
    const key = result.options[0].optionKey;
    fixtureTestHooks.expireOffer(optionRecord(c, key).offerId);
    await expectAppError(preview(c, { searchId: result.searchId, optionKey: key }), "OFFER_EXPIRED");
    expect(c.session.preview).toBeUndefined();
    expect(fixtureTestHooks.snapshot().pending).toBe(0);
  });

  it("rejects expired search results and clears the record", async () => {
    const { c, result } = await searched();
    c.session = { ...c.session, search: { ...c.session.search!, expiresAt: new Date(Date.now() - 1000).toISOString() } };
    await expectAppError(preview(c, { searchId: result.searchId, optionKey: result.options[0].optionKey }), "OFFER_EXPIRED");
    expect(c.session.search).toBeUndefined();
  });

  it("detects an order that changed after the search and clears the search", async () => {
    const { c, result } = await searched();
    fixtureTestHooks.perturbOrder(c.session.orderId!);
    await expectAppError(preview(c, { searchId: result.searchId, optionKey: result.options[0].optionKey }), "TRIP_CHANGED");
    expect(c.session.search).toBeUndefined();
    expect(c.session.preview).toBeUndefined();
    expect(fixtureTestHooks.snapshot().pending).toBe(0);
  });

  it("a new preview supersedes the old one", async () => {
    const { c, result, pv: first } = await previewed();
    const second = await preview(c, { searchId: result.searchId, optionKey: result.options[1].optionKey });
    expect(second.previewId).not.toBe(first.previewId);
    expect(c.session.preview!.previewId).toBe(second.previewId);
    expect((await getTrip(c)).preview?.previewId).toBe(second.previewId);

    const err = await expectAppError(apply(c, { previewId: first.previewId, idempotencyKey: "idem_00000001" }), "PREVIEW_EXPIRED");
    expect(err.details?.reason).toBe("superseded");
    expect(fixtureTestHooks.snapshot().confirmed).toBe(0);
    expect(c.session.preview!.previewId).toBe(second.previewId);
  });

  it("propagates a provider failure while staging without recording a preview", async () => {
    const { c, result } = await searched();
    fixtureTestHooks.failNext("createPendingChange", new AppError("PROVIDER_UNAVAILABLE", "down"));
    await expectAppError(preview(c, { searchId: result.searchId, optionKey: result.options[0].optionKey }), "PROVIDER_UNAVAILABLE");
    expect(c.session.preview).toBeUndefined();
    expect(c.session.search).toBeDefined();
  });
});
