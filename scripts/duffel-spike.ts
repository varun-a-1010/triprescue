/**
 * Duffel kill-shot spike (disposable, server-side only).
 *
 * Proves the full lifecycle against Duffel TEST mode:
 *   seed LHR→LTN ZZ order → one simulated airline change → refetch → change
 *   request → pending change → confirm (balance) → refetch → itinerary matches.
 *
 * Usage: npm run spike            (reads DUFFEL_ACCESS_TOKEN from .env.local)
 *        npm run spike -- --runs=2
 * Prints ONLY sanitized ids, times, and amounts. Never prints the token or passenger data.
 */
import { Duffel } from "@duffel/api";
import { DuffelProvider } from "../lib/providers/duffel";
import { sameItinerary } from "../lib/fingerprint";
import { futureDate } from "../lib/time";
import { isPositiveAmount } from "../lib/money";
import type { ItinerarySummary } from "../lib/types";

const token = process.env.DUFFEL_ACCESS_TOKEN ?? "";
if (!token.startsWith("duffel_test_")) {
  console.error("DUFFEL_ACCESS_TOKEN missing or not a test-mode token (expected duffel_test_ prefix).");
  process.exit(2);
}
const runs = Number((process.argv.find((a) => a.startsWith("--runs=")) ?? "--runs=2").split("=")[1]) || 2;

const provider = new DuffelProvider(new Duffel({ token, source: "triprescue-spike" }));

function itin(i: ItinerarySummary): string {
  return i.segments.map((s) => `${s.carrierCode}${s.flightNumber} ${s.origin}→${s.destination} ${s.departingAt}→${s.arrivingAt}`).join(" | ") || "(none)";
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const out = await fn();
  console.log(`  [${label}] ${Date.now() - t}ms`);
  return out;
}

async function runOnce(n: number): Promise<boolean> {
  console.log(`\n=== RUN ${n} ===`);
  const departureDate = futureDate(45 + n);
  const order = await timed("createDemoOrder", () => provider.createDemoOrder({ departureDate }));
  console.log(`  order ${order.id} ref ${order.bookingReference} owner ${order.ownerCode} actions ${order.availableActions.join(",")}`);
  console.log(`  slice ${order.slices[0].id}: ${itin(order.slices[0].itinerary)}`);
  if (!order.availableActions.includes("change")) {
    console.log("  FAIL: order does not advertise the change action");
    return false;
  }

  const change = await timed("simulateAirlineChange", () => provider.simulateAirlineChange(order.id));
  console.log(`  aic ${change.id} actions ${change.availableActions.join(",")}`);
  console.log(`    removed: ${itin(change.removed)}`);
  console.log(`    added:   ${itin(change.added)}`);

  const after1 = await timed("getOrder(after AIC)", () => provider.getOrder(order.id));
  const current = after1.slices[0];
  console.log(`  current slice ${current.id} (was ${order.slices[0].id}): ${itin(current.itinerary)}`);
  console.log(`  order.airlineChanges=${after1.airlineChanges.length} actions ${after1.availableActions.join(",")}`);

  const { requestId, offers } = await timed("searchChangeOffers", () =>
    provider.searchChangeOffers({
      orderId: order.id,
      removeSliceId: current.id,
      origin: current.origin,
      destination: current.destination,
      departureDate: current.departureDate,
      cabinClass: "economy",
    }),
  );
  console.log(`  change request ${requestId}: ${offers.length} offers`);
  if (offers.length === 0) {
    console.log("  FAIL: no change offers");
    return false;
  }
  for (const o of offers.slice(0, 4)) {
    console.log(`    ${o.id} total ${o.changeTotal.amount} ${o.changeTotal.currency} penalty ${o.penalty.amount} exp ${o.expiresAt}`);
    console.log(`      add: ${itin(o.add)}`);
  }
  // Prefer an option that differs from the current itinerary so the change is observable.
  const chosen = offers.find((o) => !sameItinerary(o.add, current.itinerary)) ?? offers[0];
  console.log(`  chosen ${chosen.id}`);

  const pending = await timed("createPendingChange", () => provider.createPendingChange(chosen.id));
  console.log(`  pending ${pending.id} total ${pending.changeTotal.amount} ${pending.changeTotal.currency} confirmedAt ${pending.confirmedAt} exp ${pending.expiresAt}`);

  const payment = isPositiveAmount(pending.changeTotal.amount) ? pending.changeTotal : null;
  const confirmed = await timed("confirmChange", () => provider.confirmChange(pending.id, payment));
  console.log(`  confirmedAt ${confirmed.confirmedAt} paid ${payment ? payment.amount : "0"}`);

  const after2 = await timed("getOrder(after confirm)", () => provider.getOrder(order.id));
  console.log(`  final slice ${after2.slices[0].id}: ${itin(after2.slices[0].itinerary)}`);
  const ok = sameItinerary(after2.slices[0].itinerary, confirmed.add);
  console.log(ok ? "  PASS: refetched itinerary matches the chosen replacement" : "  FAIL: refetched itinerary does not match the replacement");

  // Idempotency probe: a second confirm must not double-apply.
  try {
    await provider.confirmChange(pending.id, payment);
    console.log("  WARN: second confirm did not error (check provider behaviour)");
  } catch (err) {
    console.log(`  second confirm rejected as expected: ${(err as { code?: string }).code ?? "error"}`);
  }
  return ok;
}

(async () => {
  const results: boolean[] = [];
  for (let i = 1; i <= runs; i += 1) {
    try {
      results.push(await runOnce(i));
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown };
      console.log(`  ERROR ${e.code ?? ""} ${e.message ?? String(err)} ${e.details ? JSON.stringify(e.details) : ""}`);
      results.push(false);
    }
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${runs} runs passed → ${passed === runs ? "GO" : "NO-GO"}`);
  process.exit(passed === runs ? 0 : 1);
})();
