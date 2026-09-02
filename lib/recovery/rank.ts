import type { ItinerarySummary, Money, RecoveryOption, RecoveryPreferences } from "../types";
import type { ProviderChangeOffer } from "../providers/types";
import { compareAmounts, subtractAmounts } from "../money";
import { compareInstants } from "../time";

export function arrivalOf(itinerary: ItinerarySummary): string {
  const last = itinerary.segments[itinerary.segments.length - 1];
  return last.arrivingAt;
}

export type EligibilityVerdict = { eligible: boolean; reasons: string[] };

/**
 * Filter rules, applied in order. Every failing rule is reported so a
 * no-results state can explain exactly which constraint eliminated an option.
 */
export function evaluateEligibility(
  itinerary: ItinerarySummary,
  totalCost: Money,
  prefs: RecoveryPreferences,
): EligibilityVerdict {
  const reasons: string[] = [];
  if (prefs.arriveBy && compareInstants(arrivalOf(itinerary), prefs.arriveBy) > 0) {
    reasons.push(`arrives after ${prefs.arriveBy}`);
  }
  if (prefs.maxExtraAmount !== undefined && compareAmounts(totalCost.amount, prefs.maxExtraAmount) > 0) {
    reasons.push(`costs ${totalCost.amount} ${totalCost.currency}, above the ${prefs.maxExtraAmount} limit`);
  }
  if (prefs.maxStops !== undefined && itinerary.stops > prefs.maxStops) {
    reasons.push(`${itinerary.stops} stop${itinerary.stops === 1 ? "" : "s"}, above the ${prefs.maxStops} limit`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export function toRecoveryOption(
  offer: ProviderChangeOffer,
  optionKey: string,
  prefs: RecoveryPreferences,
): RecoveryOption {
  const totalCost = offer.changeTotal;
  const penalty = offer.penalty;
  const fareDelta: Money = {
    amount: subtractAmounts(totalCost.amount, penalty.amount),
    currency: totalCost.currency,
  };
  const verdict = evaluateEligibility(offer.add, totalCost, prefs);
  return {
    optionKey,
    itinerary: offer.add,
    fareDelta,
    penalty,
    totalCost,
    expiresAt: offer.expiresAt,
    eligible: verdict.eligible,
    eligibilityReasons: verdict.reasons,
  };
}

/** Rank: earliest arrival, then lowest total change cost, then fewest stops. */
export function rankOptions(options: RecoveryOption[]): RecoveryOption[] {
  return [...options].sort((a, b) => {
    const byArrival = compareInstants(arrivalOf(a.itinerary), arrivalOf(b.itinerary));
    if (byArrival !== 0) return byArrival;
    const byCost = compareAmounts(a.totalCost.amount, b.totalCost.amount);
    if (byCost !== 0) return byCost;
    return a.itinerary.stops - b.itinerary.stops;
  });
}

export function partitionOptions(options: RecoveryOption[]): {
  eligible: RecoveryOption[];
  ineligible: RecoveryOption[];
} {
  const ranked = rankOptions(options);
  return {
    eligible: ranked.filter((o) => o.eligible),
    ineligible: ranked.filter((o) => !o.eligible),
  };
}
