"use client";

import type { ItinerarySummary, Money, ProviderMode } from "@/lib/types";
import { money, signedMoney } from "./format";
import { Itinerary } from "./itinerary";
import { Icon, Row, Tag } from "./ui";

type Pair = { before: string; after: string };

type ComparisonProps = {
  before: ItinerarySummary;
  after: ItinerarySummary;
  headings?: Pair;
  labels?: Pair;
  size?: "md" | "sm";
};

/**
 * The exact before/after. Removed is struck and dimmed with a label and icon;
 * added is highlighted with a label and icon. Never colour-only.
 */
export function ChangeComparison({
  before,
  after,
  headings = { before: "Current", after: "Proposed" },
  labels = { before: "Removed", after: "Added" },
  size = "md",
}: ComparisonProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section aria-label={`${headings.before} itinerary, ${labels.before.toLowerCase()}`} className="rounded-card border border-dashed border-line-strong p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-ink-2">{headings.before}</h3>
          <Tag tone="muted" size="sm" icon={<Icon name="minus" size={12} />}>
            {labels.before}
          </Tag>
        </div>
        <Itinerary itinerary={before} tone="removed" size={size} />
      </section>
      <section aria-label={`${headings.after} itinerary, ${labels.after.toLowerCase()}`} className="rounded-card border border-accent bg-accent-soft p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-accent-ink">{headings.after}</h3>
          <Tag tone="accent" size="sm" icon={<Icon name="plus" size={12} />}>
            {labels.after}
          </Tag>
        </div>
        <Itinerary itinerary={after} tone="added" size={size} />
      </section>
    </div>
  );
}

type PriceProps = {
  fareDelta: Money;
  penalty: Money;
  totalCost: Money;
  providerMode: ProviderMode | null;
};

export function PriceBreakdown({ fareDelta, penalty, totalCost, providerMode }: PriceProps) {
  const note = providerMode === "fixture" ? "Recorded by the fixture provider, nothing is charged" : "Charged to the Duffel test balance, not a real card";
  return (
    <dl className="rounded-card border border-line px-4 py-1" aria-label="Price">
      <Row label="Fare difference" value={signedMoney(fareDelta)} />
      <Row label="Change penalty" value={money(penalty)} />
      <Row
        label="Total to pay"
        strong
        note={note}
        value={
          <>
            {money(totalCost)} <span className="text-sm font-normal text-ink-2">{totalCost.currency}</span>
          </>
        }
      />
    </dl>
  );
}
