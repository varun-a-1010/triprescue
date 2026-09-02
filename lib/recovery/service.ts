import { AppError, isAppError } from "../errors";
import { orderFingerprint, sameItinerary } from "../fingerprint";
import { log } from "../log";
import { isPositiveAmount, subtractAmounts } from "../money";
import { evaluateEligibility, partitionOptions, toRecoveryOption } from "./rank";
import type { FlightRecoveryProvider, ProviderOrder, ProviderPendingChange, ProviderSlice } from "../providers/types";
import { opaqueId, tripIdFor, type SearchRecord, type SessionState } from "../session";
import { addMinutesIso, futureDate, isBefore, minInstant, nowIso } from "../time";
import type {
  ChangePreview,
  ChangeResult,
  DisruptResult,
  DisruptionSummary,
  ItinerarySummary,
  RecoveryPreferences,
  RecoverySearchResult,
  SeedResult,
  StatusResult,
  TripState,
  TripSummary,
  Verification,
} from "../types";
import type { ApplyInput, PreviewInput, SeedInput } from "../validation";

export const DEMO_DEPARTURE_DAYS = 45;
export const SEARCH_TTL_MINUTES = 20;
export const PREVIEW_TTL_MINUTES = 15;
export const MAX_UI_OPTIONS = 5;

/**
 * Mutable per-request context. Services replace `ctx.session` with the new
 * state; the HTTP layer persists whatever is there afterwards, on success AND
 * on application errors, so "clear the stale preview" style transitions are
 * never lost.
 */
export type ServiceCtx = {
  provider: FlightRecoveryProvider;
  session: SessionState;
  requestId: string;
};

function requireOrderId(ctx: ServiceCtx): string {
  const orderId = ctx.session.orderId;
  if (!orderId) {
    throw new AppError("NO_DEMO_ORDER", "No sandbox trip exists for this session yet. Create one first.");
  }
  return orderId;
}

export function currentSlice(order: ProviderOrder): ProviderSlice {
  const slice = order.slices[0];
  if (!slice) throw new AppError("TRIP_CHANGED", "The order has no slices.", { details: { reason: "no_slices" } });
  return slice;
}

function localClock(iso: string): string {
  return iso.slice(11, 16);
}

function tripSummary(order: ProviderOrder, ctx: ServiceCtx): TripSummary {
  const slice = currentSlice(order);
  return {
    tripId: tripIdFor(order.id),
    providerOrderId: order.id,
    bookingReference: order.bookingReference,
    carrierCode: order.ownerCode,
    itinerary: slice.itinerary,
    status: ctx.session.tripStatus ?? "booked",
    changeAvailable: order.availableActions.includes("change"),
    sandbox: true,
    providerMode: ctx.provider.mode,
  };
}

function disruptionSummary(order: ProviderOrder, ctx: ServiceCtx): DisruptionSummary | null {
  const rec = ctx.session.disruption;
  if (!rec) return null;
  const change = order.airlineChanges.find((c) => c.id === rec.changeId) ?? null;
  const before = change?.removed.segments[0];
  const after = change?.added.segments[0];
  const message =
    before && after
      ? `Simulated airline schedule change: ${after.carrierCode} ${after.flightNumber} ${after.origin}→${after.destination} moved from ${localClock(before.departingAt)} to ${localClock(after.departingAt)} on ${after.departingAt.slice(0, 10)}.`
      : "Simulated airline schedule change received for this sandbox booking.";
  return {
    kind: "airline_schedule_change",
    status: change?.actionTaken ? `resolved (${change.actionTaken})` : "action required",
    receivedAt: change?.createdAt ?? rec.triggeredAt,
    message,
    previous: change?.removed ?? null,
  };
}

function previewFromPending(previewId: string, before: ItinerarySummary, pending: ProviderPendingChange, expiresAt: string): ChangePreview {
  return {
    previewId,
    before,
    after: pending.add,
    fareDelta: { amount: subtractAmounts(pending.changeTotal.amount, pending.penalty.amount), currency: pending.changeTotal.currency },
    penalty: pending.penalty,
    totalCost: pending.changeTotal,
    expiresAt,
    sandbox: true,
  };
}

async function activePreview(order: ProviderOrder, ctx: ServiceCtx): Promise<ChangePreview | null> {
  const rec = ctx.session.preview;
  if (!rec || rec.consumed) return null;
  if (isBefore(rec.expiresAt, nowIso())) return null;
  try {
    const pending = await ctx.provider.getPendingChange(rec.changeId);
    if (pending.confirmedAt) return null;
    if (isBefore(pending.expiresAt, nowIso())) return null;
    return previewFromPending(rec.previewId, pending.remove.segments.length ? pending.remove : currentSlice(order).itinerary, pending, rec.expiresAt);
  } catch (err) {
    if (isAppError(err) && (err.code === "PREVIEW_EXPIRED" || err.code === "OFFER_EXPIRED")) return null;
    throw err;
  }
}

async function tripState(order: ProviderOrder, ctx: ServiceCtx): Promise<TripState> {
  return {
    trip: tripSummary(order, ctx),
    disruption: disruptionSummary(order, ctx),
    preview: await activePreview(order, ctx),
    providerMode: ctx.provider.mode,
  };
}

// ---------------------------------------------------------------------------

export async function seed(ctx: ServiceCtx, input: SeedInput): Promise<SeedResult> {
  const existing = ctx.session.orderId;
  if (existing && !input.forceNew) {
    try {
      const order = await ctx.provider.getOrder(existing);
      return { status: "existing", ...(await tripState(order, ctx)) };
    } catch (err) {
      if (!(isAppError(err) && err.code === "NO_DEMO_ORDER")) throw err;
      // The order vanished (e.g. fixture store reset): fall through and reseed.
    }
  }
  const order = await ctx.provider.createDemoOrder({ departureDate: futureDate(DEMO_DEPARTURE_DAYS) });
  if (!order.availableActions.includes("change")) {
    throw new AppError("ORDER_NOT_CHANGEABLE", "The sandbox order was created but does not allow changes. Reseed to try again.", {
      details: { providerOrderId: order.id },
    });
  }
  ctx.session = { v: 1, sid: ctx.session.sid, orderId: order.id, tripStatus: "booked" };
  log("trip.seeded", { requestId: ctx.requestId, orderId: order.id, provider: ctx.provider.mode });
  return { status: "created", ...(await tripState(order, ctx)) };
}

export async function getTrip(ctx: ServiceCtx): Promise<TripState> {
  const orderId = requireOrderId(ctx);
  const order = await ctx.provider.getOrder(orderId);
  return tripState(order, ctx);
}

export async function disrupt(ctx: ServiceCtx): Promise<DisruptResult> {
  const orderId = requireOrderId(ctx);
  if (ctx.session.disruption) {
    const order = await ctx.provider.getOrder(orderId);
    return { status: "already_triggered", ...(await tripState(order, ctx)) };
  }
  // Exactly-once per order on this instance: the provider call is serialized
  // per orderId and the session is re-checked inside the lock, so a burst of
  // concurrent requests sharing one session produces one simulated change.
  return withLock(`disrupt:${orderId}`, async () => {
    if (ctx.session.disruption) {
      const order = await ctx.provider.getOrder(orderId);
      return { status: "already_triggered" as const, ...(await tripState(order, ctx)) };
    }
    const triggeredAt = nowIso();
    const change = await ctx.provider.simulateAirlineChange(orderId);
    ctx.session = {
      ...ctx.session,
      disruption: { changeId: change.id, triggeredAt },
      search: undefined,
      preview: undefined,
    };
    const order = await ctx.provider.getOrder(orderId);
    log("trip.disrupted", { requestId: ctx.requestId, orderId, changeId: change.id });
    return { status: "triggered" as const, ...(await tripState(order, ctx)) };
  });
}

export async function search(ctx: ServiceCtx, prefs: RecoveryPreferences): Promise<RecoverySearchResult> {
  const orderId = requireOrderId(ctx);
  const order = await ctx.provider.getOrder(orderId);
  if (!order.availableActions.includes("change")) {
    throw new AppError("ORDER_NOT_CHANGEABLE", "This sandbox order does not currently allow changes.");
  }
  const slice = currentSlice(order);
  const { offers } = await ctx.provider.searchChangeOffers({
    orderId,
    removeSliceId: slice.id,
    origin: slice.origin,
    destination: slice.destination,
    departureDate: slice.departureDate,
    cabinClass: "economy",
  });
  if (offers.length === 0) {
    throw new AppError("NO_RECOVERY_OPTIONS", "The airline returned no change offers for this trip. Try again shortly or reseed.");
  }
  const now = nowIso();
  const fingerprint = orderFingerprint(order);
  const searchId = opaqueId("srch");
  const keyed = offers.map((offer) => ({ offer, option: toRecoveryOption(offer, opaqueId("opt"), prefs) }));
  const { eligible, ineligible } = partitionOptions(keyed.map((k) => k.option));
  const visible = [...eligible.slice(0, MAX_UI_OPTIONS), ...ineligible.slice(0, MAX_UI_OPTIONS)];
  let expiresAt = addMinutesIso(now, SEARCH_TTL_MINUTES);
  for (const o of visible) expiresAt = minInstant(expiresAt, o.expiresAt);

  const options: SearchRecord["options"] = {};
  for (const { offer, option } of keyed) {
    if (visible.some((v) => v.optionKey === option.optionKey)) {
      options[option.optionKey] = { offerId: offer.id, expiresAt: offer.expiresAt, total: offer.changeTotal };
    }
  }
  ctx.session = {
    ...ctx.session,
    search: { searchId, createdAt: now, expiresAt, fingerprint, prefs, currency: offers[0].changeTotal.currency, options },
  };
  log("recovery.searched", { requestId: ctx.requestId, orderId, searchId, offers: offers.length, eligible: eligible.length });
  return {
    searchId,
    currency: offers[0].changeTotal.currency,
    constraints: prefs,
    options: eligible.slice(0, MAX_UI_OPTIONS),
    ineligible: ineligible.slice(0, MAX_UI_OPTIONS),
    expiresAt,
    sandbox: true,
  };
}

export async function preview(ctx: ServiceCtx, input: PreviewInput): Promise<ChangePreview> {
  const orderId = requireOrderId(ctx);
  const rec = ctx.session.search;
  if (!rec || rec.searchId !== input.searchId) {
    throw new AppError("OPTION_NOT_IN_PREVIEW", "That search is not the current one for this session. Run a new search and pick an option from it.");
  }
  const now = nowIso();
  if (isBefore(rec.expiresAt, now)) {
    ctx.session = { ...ctx.session, search: undefined };
    throw new AppError("OFFER_EXPIRED", "The search results have expired. Run a new search.");
  }
  const option = rec.options[input.optionKey];
  if (!option) {
    throw new AppError("OPTION_NOT_IN_PREVIEW", "That option is not part of the current search results.");
  }
  const offer = await ctx.provider.getChangeOffer(option.offerId);
  if (isBefore(offer.expiresAt, now)) {
    throw new AppError("OFFER_EXPIRED", "That change offer has expired. Run a new search.");
  }
  const order = await ctx.provider.getOrder(orderId);
  if (orderFingerprint(order) !== rec.fingerprint) {
    ctx.session = { ...ctx.session, search: undefined, preview: undefined };
    throw new AppError("TRIP_CHANGED", "The booking changed since this search ran. Refresh and search again.");
  }
  const verdict = evaluateEligibility(offer.add, offer.changeTotal, rec.prefs);
  if (!verdict.eligible) {
    throw new AppError("OPTION_NOT_IN_PREVIEW", `That option no longer meets the search constraints: ${verdict.reasons.join("; ")}.`, {
      details: { reason: "ineligible" },
    });
  }
  const pending = await ctx.provider.createPendingChange(offer.id);
  const expiresAt = minInstant(pending.expiresAt, addMinutesIso(now, PREVIEW_TTL_MINUTES));
  const previewId = opaqueId("prv");
  ctx.session = {
    ...ctx.session,
    preview: {
      previewId,
      searchId: rec.searchId,
      optionKey: input.optionKey,
      changeId: pending.id,
      fingerprint: rec.fingerprint,
      total: pending.changeTotal,
      createdAt: now,
      expiresAt,
      consumed: false,
    },
  };
  log("recovery.previewed", { requestId: ctx.requestId, orderId, previewId, changeId: pending.id, total: pending.changeTotal.amount });
  return previewFromPending(previewId, currentSlice(order).itinerary, pending, expiresAt);
}

// One in-process lock per pending change so a double-submit on one instance
// serializes; the provider's own already-confirmed rejection covers the rest.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, settled);
  try {
    return await run;
  } finally {
    if (locks.get(key) === settled) locks.delete(key);
  }
}

function resultFrom(status: ChangeResult["status"], pending: ProviderPendingChange, after: ProviderOrder, now: string): ChangeResult {
  const verified = sameItinerary(currentSlice(after).itinerary, pending.add);
  return {
    status,
    before: pending.remove,
    after: pending.add,
    totalCost: pending.changeTotal,
    confirmedAt: pending.confirmedAt ?? now,
    verifiedAt: now,
    verified,
    sandbox: true,
  };
}

export async function apply(ctx: ServiceCtx, input: ApplyInput): Promise<ChangeResult> {
  const orderId = requireOrderId(ctx);
  const rec = ctx.session.preview;
  const now = nowIso();

  if (!rec || rec.previewId !== input.previewId) {
    const applied = ctx.session.applied;
    if (applied && applied.previewId === input.previewId) {
      const pending = await ctx.provider.getPendingChange(applied.changeId);
      const after = await ctx.provider.getOrder(orderId);
      return resultFrom("already_confirmed", pending, after, now);
    }
    throw new AppError("PREVIEW_EXPIRED", rec ? "That preview was superseded by a newer one." : "There is no staged change to apply. Preview an option first.", {
      details: { reason: rec ? "superseded" : "missing" },
    });
  }

  return withLock(rec.changeId, async () => {
    const pending = await ctx.provider.getPendingChange(rec.changeId);
    if (pending.confirmedAt) {
      const after = await ctx.provider.getOrder(orderId);
      ctx.session = markApplied(ctx.session, rec.previewId, rec.changeId, input.idempotencyKey, pending.confirmedAt);
      return resultFrom("already_confirmed", pending, after, now);
    }
    if (isBefore(rec.expiresAt, now) || isBefore(pending.expiresAt, now)) {
      ctx.session = { ...ctx.session, preview: undefined };
      throw new AppError("PREVIEW_EXPIRED", "The staged change expired before it was confirmed. Preview it again.");
    }
    const order = await ctx.provider.getOrder(orderId);
    if (orderFingerprint(order) !== rec.fingerprint) {
      ctx.session = { ...ctx.session, preview: undefined, search: undefined };
      throw new AppError("TRIP_CHANGED", "The booking changed since this preview was staged. Refresh and search again.");
    }
    if (pending.changeTotal.amount !== rec.total.amount || pending.changeTotal.currency !== rec.total.currency) {
      ctx.session = { ...ctx.session, preview: undefined };
      throw new AppError("PREVIEW_EXPIRED", "The price of the staged change moved. Preview it again to see the current amount.", {
        details: { reason: "price_changed" },
      });
    }

    const payment = isPositiveAmount(pending.changeTotal.amount) ? pending.changeTotal : null;
    let confirmed: ProviderPendingChange;
    let status: ChangeResult["status"] = "confirmed";
    try {
      confirmed = await ctx.provider.confirmChange(pending.id, payment);
    } catch (err) {
      if (isAppError(err) && err.code === "ALREADY_CONFIRMED") {
        confirmed = await ctx.provider.getPendingChange(pending.id);
        status = "already_confirmed";
      } else {
        throw err;
      }
    }
    const after = await ctx.provider.getOrder(orderId);
    ctx.session = markApplied(ctx.session, rec.previewId, rec.changeId, input.idempotencyKey, confirmed.confirmedAt ?? now);
    const result = resultFrom(status, confirmed, after, now);
    log("recovery.applied", {
      requestId: ctx.requestId,
      orderId,
      changeId: pending.id,
      status,
      verified: result.verified,
      paid: payment ? payment.amount : "0",
    });
    return result;
  });
}

function markApplied(session: SessionState, previewId: string, changeId: string, idempotencyKey: string, confirmedAt: string): SessionState {
  return {
    ...session,
    tripStatus: "changed",
    search: undefined,
    preview: session.preview ? { ...session.preview, consumed: true } : undefined,
    applied: { previewId, changeId, idempotencyKey, confirmedAt },
  };
}

export async function status(ctx: ServiceCtx): Promise<StatusResult> {
  const orderId = requireOrderId(ctx);
  const order = await ctx.provider.getOrder(orderId);
  const state = await tripState(order, ctx);
  const now = nowIso();
  let verification: Verification = { applied: false, verified: false, verifiedAt: now, confirmedAt: null, intended: null };
  const applied = ctx.session.applied;
  if (applied) {
    const pending = await ctx.provider.getPendingChange(applied.changeId);
    verification = {
      applied: true,
      verified: sameItinerary(currentSlice(order).itinerary, pending.add),
      verifiedAt: now,
      confirmedAt: pending.confirmedAt,
      intended: pending.add,
    };
  }
  return { ...state, verification };
}
