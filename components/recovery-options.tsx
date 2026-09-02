"use client";

import { useState } from "react";
import { preview as stagePreview } from "@/lib/client/store";
import type { RecoveryOption, RecoverySearchResult } from "@/lib/types";
import { durationLabel, firstSegment, flightsLabel, lastSegment, localDate, localDateTime, localTime, money, relativeExpiry, routeLabel, signedMoney, stopsLabel } from "./format";
import { Button, Icon, Tag } from "./ui";
import { useNow } from "./use-now";

type Props = {
  search: RecoverySearchResult;
  busy: string | null;
  /** Render as a closed disclosure (used beneath the change preview). */
  collapsed?: boolean;
  onEditLimits: () => void;
};

export function RecoveryOptions({ search, busy, collapsed = false, onEditLimits }: Props) {
  const now = useNow();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const staging = busy === "preview" ? pendingKey : null;
  const locked = busy !== null;
  const results = relativeExpiry(search.expiresAt, now);
  const eligible = search.options;
  const ineligible = search.ineligible;

  function onPreview(optionKey: string) {
    setPendingKey(optionKey);
    stagePreview(search.searchId, optionKey).catch(() => {
      // Surfaced through state.error.
    });
  }

  const body =
    eligible.length === 0 ? (
      <EmptyState search={search} now={now} onEditLimits={onEditLimits} />
    ) : (
      <>
        <ol className="flex flex-col gap-3">
          {eligible.map((option, i) => (
            <OptionCard
              key={option.optionKey}
              option={option}
              rank={i + 1}
              now={now}
              locked={locked}
              staging={staging === option.optionKey}
              onPreview={() => onPreview(option.optionKey)}
            />
          ))}
        </ol>
        {ineligible.length > 0 ? (
          <details className="disclosure mt-4 rounded-card border border-line">
            <summary className="flex items-center gap-2 px-4 py-3 text-sm font-medium">
              <Icon name="chevron" size={14} className="disclosure-chevron" />
              {ineligible.length} option{ineligible.length === 1 ? "" : "s"} didn’t meet your limits
            </summary>
            <ol className="flex flex-col gap-3 border-t border-line p-3">
              {ineligible.map((option) => (
                <OptionCard key={option.optionKey} option={option} now={now} locked={locked} staging={false} />
              ))}
            </ol>
          </details>
        ) : null}
      </>
    );

  if (collapsed) {
    return (
      <details className="disclosure card">
        <summary className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 font-medium">
            <Icon name="chevron" size={14} className="disclosure-chevron" />
            Other options from this search
          </span>
          <span className="text-sm text-ink-2">
            {eligible.length} eligible, {ineligible.length} outside your limits
          </span>
        </summary>
        <div className="border-t border-line p-3 sm:p-4">{body}</div>
      </details>
    );
  }

  return (
    <section aria-labelledby="options-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="options-heading" className="text-lg font-semibold tracking-tight">
            Recovery options
          </h2>
          <p className="text-sm text-ink-2">Ranked by earliest arrival, then lowest total, then fewest stops.</p>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          <Icon name="clock" size={14} />
          {results.expired ? "Results have expired, search again" : `Results valid for ${results.label}`}
        </p>
      </div>
      {body}
    </section>
  );
}

type CardProps = {
  option: RecoveryOption;
  rank?: number;
  now: number;
  locked: boolean;
  staging: boolean;
  onPreview?: () => void;
};

function OptionCard({ option, rank, now, locked, staging, onPreview }: CardProps) {
  const it = option.itinerary;
  const first = firstSegment(it);
  const last = lastSegment(it);
  const expiry = relativeExpiry(option.expiresAt, now);
  const duration = durationLabel(it);

  return (
    <li className={`card p-4 sm:p-5 ${option.eligible ? "" : "bg-paper"}`} data-option-key={option.optionKey}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {rank ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 text-xs font-semibold tabular-nums text-accent-ink">
                {rank}
              </span>
            ) : (
              <Tag tone="alert" size="sm" icon={<Icon name="cross" size={12} />}>
                Outside your limits
              </Tag>
            )}
            <span>
              {stopsLabel(it)}
              {duration ? `, ${duration}` : ""}
            </span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-ink">
            <span className="text-base font-medium text-ink-2">Arrives </span>
            {last ? <time dateTime={last.arrivingAt}>{localTime(last.arrivingAt)}</time> : "—"}
          </p>
          {first ? (
            <p className="text-sm text-ink-2">
              Departs <time dateTime={first.departingAt}>{localTime(first.departingAt)}</time> on {localDate(first.departingAt)}
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-2 tabular-nums">
            <span>{flightsLabel(it)}</span>
            <span>{routeLabel(it)}</span>
          </p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
          <dt className="text-ink-2">Fare difference</dt>
          <dd className="text-right">{signedMoney(option.fareDelta)}</dd>
          <dt className="text-ink-2">Change penalty</dt>
          <dd className="text-right">{money(option.penalty)}</dd>
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="text-right font-semibold text-ink">{money(option.totalCost)}</dd>
        </dl>
      </div>

      {!option.eligible && option.eligibilityReasons.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-alert-ink">
          {option.eligibilityReasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <Icon name="cross" size={14} className="mt-1 shrink-0" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className="flex items-center gap-1.5 text-sm text-ink-2">
          <Icon name="clock" size={14} />
          {expiry.expired ? "Offer expired" : `Offer expires in ${expiry.label}`}
        </span>
        {option.eligible && onPreview ? (
          <Button variant="primary" busy={staging} busyLabel="Staging…" disabled={locked || expiry.expired} onClick={onPreview}>
            Preview this option
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function EmptyState({ search, now, onEditLimits }: { search: RecoverySearchResult; now: number; onEditLimits: () => void }) {
  const c = search.constraints;
  const limits: string[] = [];
  if (c.arriveBy) limits.push(`arrive by ${localDateTime(c.arriveBy)}`);
  if (c.maxExtraAmount) limits.push(`max extra ${money({ amount: c.maxExtraAmount, currency: search.currency })}`);
  if (c.maxStops !== undefined) limits.push(c.maxStops === 0 ? "nonstop only" : `up to ${c.maxStops} stop${c.maxStops === 1 ? "" : "s"}`);
  const reasons = Array.from(new Set(search.ineligible.flatMap((o) => o.eligibilityReasons)));
  const count = search.ineligible.length;

  return (
    <div className="card p-5 sm:p-6">
      <h3 className="font-semibold text-ink">No option meets every limit</h3>
      <p className="mt-1 text-sm text-ink-2">
        {count === 0
          ? "The provider returned no change options for this booking."
          : limits.length
            ? `Your limits (${limits.join(", ")}) ruled out all ${count} option${count === 1 ? "" : "s"}.`
            : `All ${count} option${count === 1 ? "" : "s"} failed a check.`}
      </p>
      {reasons.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-alert-ink">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <Icon name="cross" size={14} className="mt-1 shrink-0" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 text-sm text-ink-2">Relax one limit and search again. Nothing is relaxed for you automatically.</p>
      <Button className="mt-3" variant="secondary" onClick={onEditLimits}>
        Edit limits
      </Button>
      {count > 0 ? (
        <details className="disclosure mt-5 rounded-card border border-line">
          <summary className="flex items-center gap-2 px-4 py-3 text-sm font-medium">
            <Icon name="chevron" size={14} className="disclosure-chevron" />
            Show the {count} option{count === 1 ? "" : "s"} outside your limits
          </summary>
          <ol className="flex flex-col gap-3 border-t border-line p-3">
            {search.ineligible.map((option) => (
              <OptionCard key={option.optionKey} option={option} now={now} locked staging={false} />
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
