"use client";

import { reset, status as checkStatus } from "@/lib/client/store";
import type { ChangeResult, ProviderMode, Verification } from "@/lib/types";
import { ChangeComparison } from "./change-comparison";
import { instantLabel, money } from "./format";
import { Button, Icon } from "./ui";

type Props = {
  result: ChangeResult;
  verification: Verification | null;
  busy: string | null;
  providerMode: ProviderMode | null;
};

export function VerifiedCard({ result, verification, busy, providerMode }: Props) {
  // The latest refetch wins: "Check status" refreshes `verification` after the apply result.
  const verified = verification ? verification.verified : result.verified;
  const verifiedAt = verification?.verifiedAt ?? result.verifiedAt;
  const confirmedAt = verification?.confirmedAt ?? result.confirmedAt;
  const locked = busy !== null;
  const balanceLabel = providerMode === "fixture" ? "Total recorded by the fixture provider" : "Total charged to the Duffel test balance";

  return (
    <section className="card overflow-hidden" aria-labelledby="verified-heading" data-verified={verified}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink" aria-hidden="true">
          <Icon name="check" size={18} />
        </span>
        <div className="min-w-0">
          <h2 id="verified-heading" className="text-xl font-semibold tracking-tight">
            Sandbox booking changed
          </h2>
          <p className="text-sm text-ink-2">
            {result.status === "already_confirmed" ? "This change had already been confirmed. Nothing was charged twice." : "The provider accepted the change."}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <ChangeComparison
          before={result.before}
          after={result.after}
          headings={{ before: "Before", after: "After" }}
          labels={{ before: "Previous", after: "Now booked" }}
          size="sm"
        />

        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink-2">{balanceLabel}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {money(result.totalCost)} <span className="text-sm font-normal text-ink-2">{result.totalCost.currency}</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-2">Confirmed</dt>
            <dd className="mt-0.5 tabular-nums text-ink">{confirmedAt ? instantLabel(confirmedAt) : "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-ink-2">Refetched and checked</dt>
            <dd className="mt-0.5 tabular-nums text-ink">{instantLabel(verifiedAt)}</dd>
          </div>
        </dl>

        {verified ? (
          <p role="status" className="flex items-start gap-2 rounded-ctl bg-accent-soft px-3 py-2 text-sm text-accent-ink">
            <Icon name="check" size={16} className="mt-0.5 shrink-0" />
            <span>Verified: the refetched order shows the new itinerary.</span>
          </p>
        ) : (
          <p role="status" className="flex items-start gap-2 rounded-ctl border border-alert/40 bg-alert-soft px-3 py-2 text-sm text-alert-ink">
            <Icon name="warn" size={16} className="mt-0.5 shrink-0" />
            <span>Provider confirmed, but the refetched order does not yet show the new itinerary — use Check status.</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={verified ? "secondary" : "primary"}
            busy={busy === "status"}
            busyLabel="Checking…"
            disabled={locked}
            onClick={() => {
              checkStatus().catch(() => {
                // Surfaced through state.error.
              });
            }}
          >
            Check status
          </Button>
          <Button
            variant="ghost"
            busy={busy === "seed"}
            busyLabel="Creating a fresh trip…"
            disabled={locked}
            onClick={() => {
              reset().catch(() => {
                // Surfaced through state.error.
              });
            }}
          >
            Start over with a fresh sandbox trip
          </Button>
        </div>
      </div>
    </section>
  );
}
