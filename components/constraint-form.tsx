"use client";

import { useId, useState, type FormEvent } from "react";
import { search as runSearch } from "@/lib/client/store";
import type { RecoveryPreferences, RecoverySearchResult, TripSummary } from "@/lib/types";
import { localDateTime, money, offsetOf, toDatetimeLocalValue } from "./format";
import { Button, Tag } from "./ui";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

type Props = {
  trip: TripSummary;
  search: RecoverySearchResult | null;
  busy: string | null;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
};

/**
 * Arrival deadline, spend limit and stop limit. Shown in full before the first
 * search; afterwards collapsed to the applied limits with an "Edit limits" toggle.
 */
export function ConstraintForm(props: Props) {
  const { search, editing } = props;
  if (search && !editing) return <LimitsSummary search={search} onEdit={() => props.onEditingChange(true)} />;
  return <LimitsForm key={search?.searchId ?? "fresh"} {...props} />;
}

function stopsText(maxStops: 0 | 1 | 2): string {
  if (maxStops === 0) return "Nonstop only";
  return `Up to ${maxStops} stop${maxStops === 1 ? "" : "s"}`;
}

function LimitsSummary({ search, onEdit }: { search: RecoverySearchResult; onEdit: () => void }) {
  const c = search.constraints;
  const chips: string[] = [];
  if (c.arriveBy) chips.push(`Arrive by ${localDateTime(c.arriveBy)}`);
  if (c.maxExtraAmount) chips.push(`Max extra ${money({ amount: c.maxExtraAmount, currency: search.currency })}`);
  if (c.maxStops !== undefined) chips.push(stopsText(c.maxStops));
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5" aria-labelledby="limits-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="limits-heading" className="text-sm font-medium text-ink-2">
          Your limits
        </h2>
        {chips.length === 0 ? (
          <Tag tone="muted">None applied</Tag>
        ) : (
          chips.map((chip) => (
            <Tag key={chip} tone="neutral">
              {chip}
            </Tag>
          ))
        )}
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Edit limits
      </Button>
    </section>
  );
}

function LimitsForm({ trip, search, busy, onEditingChange }: Props) {
  const id = useId();
  const offset = offsetOf(trip.itinerary.segments[0]?.departingAt ?? "");
  const currency = search?.currency ?? trip.currency;
  const current = search?.constraints;
  const [arriveBy, setArriveBy] = useState(current?.arriveBy ? toDatetimeLocalValue(current.arriveBy) : "");
  const [maxExtra, setMaxExtra] = useState(current?.maxExtraAmount ?? "");
  const [maxStops, setMaxStops] = useState(current?.maxStops === undefined ? "" : String(current.maxStops));
  const [amountError, setAmountError] = useState<string | null>(null);
  const searching = busy === "search";
  const locked = busy !== null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const prefs: RecoveryPreferences = {};
    if (arriveBy) prefs.arriveBy = `${arriveBy.length === 16 ? `${arriveBy}:00` : arriveBy}${offset}`;
    const amount = maxExtra.trim();
    if (amount) {
      if (!AMOUNT_RE.test(amount)) {
        setAmountError("Enter an amount like 80 or 80.00.");
        return;
      }
      prefs.maxExtraAmount = amount;
    }
    if (maxStops !== "") prefs.maxStops = Number(maxStops) as 0 | 1 | 2;
    setAmountError(null);
    runSearch(prefs)
      .then(() => onEditingChange(false))
      .catch(() => {
        // Surfaced through state.error; the form stays so the limits can be adjusted.
      });
  }

  return (
    <form className="card p-5 sm:p-6" onSubmit={onSubmit} aria-labelledby={`${id}-heading`} noValidate>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">
          Set your limits
        </h2>
        <p className="text-sm text-ink-2">All optional. Options outside a limit are still listed, with the reason.</p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={`${id}-arrive`} className="block text-sm font-medium">
            Arrive by
          </label>
          <input
            id={`${id}-arrive`}
            type="datetime-local"
            className="field-input mt-1"
            value={arriveBy}
            onChange={(e) => setArriveBy(e.target.value)}
            disabled={locked}
            aria-describedby={`${id}-arrive-hint`}
          />
          <p id={`${id}-arrive-hint`} className="mt-1 text-xs text-ink-3">
            Airport time, UTC{offset}
          </p>
        </div>

        <div>
          <label htmlFor={`${id}-amount`} className="block text-sm font-medium">
            Max extra to pay
          </label>
          <div className="mt-1 flex items-stretch">
            <span className="inline-flex items-center rounded-l-ctl border border-r-0 border-line-strong bg-surface-2 px-2.5 text-sm text-ink-2">{currency}</span>
            <input
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              className="field-input rounded-l-none"
              placeholder="80.00"
              value={maxExtra}
              onChange={(e) => setMaxExtra(e.target.value)}
              disabled={locked}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? `${id}-amount-error` : `${id}-amount-hint`}
            />
          </div>
          {amountError ? (
            <p id={`${id}-amount-error`} className="mt-1 text-xs text-alert-ink" role="alert">
              {amountError}
            </p>
          ) : (
            <p id={`${id}-amount-hint`} className="mt-1 text-xs text-ink-3">
              Fare difference plus change penalty
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${id}-stops`} className="block text-sm font-medium">
            Max stops
          </label>
          <select id={`${id}-stops`} className="field-input mt-1" value={maxStops} onChange={(e) => setMaxStops(e.target.value)} disabled={locked}>
            <option value="">Any</option>
            <option value="0">Nonstop only</option>
            <option value="1">Up to 1 stop</option>
            <option value="2">Up to 2 stops</option>
          </select>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" busy={searching} busyLabel="Searching…" disabled={locked}>
          Find recovery options
        </Button>
        {search ? (
          <Button variant="ghost" onClick={() => onEditingChange(false)} disabled={locked}>
            Keep current limits
          </Button>
        ) : null}
      </div>
    </form>
  );
}
