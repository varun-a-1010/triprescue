"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { derivePhase, disrupt, refresh, seed, useAppState } from "@/lib/client/store";
import type { ProviderMode } from "@/lib/types";
import { ChangePreview } from "./change-preview";
import { ConfirmationDialog } from "./confirmation-dialog";
import { ConstraintForm } from "./constraint-form";
import { DisruptionBanner } from "./disruption-banner";
import { ErrorNotice } from "./error-notice";
import { ProviderBadge } from "./provider-badge";
import { RecoveryOptions } from "./recovery-options";
import { Stepper } from "./stepper";
import { ToolAuditLog } from "./tool-audit-log";
import { TripCard } from "./trip-card";
import { Button, Spinner } from "./ui";
import { VerifiedCard } from "./verified-card";
import { WebMcpIndicator } from "./webmcp-indicator";
import { WebMcpRegistry } from "./webmcp-registry";

function busyMessage(busy: string | null, mode: ProviderMode | null): string {
  const provider = mode === "fixture" ? "fixture provider" : "Duffel sandbox";
  switch (busy) {
    case "seed":
      return `Creating a sandbox trip with the ${provider}…`;
    case "disrupt":
      return "Simulating an airline schedule change…";
    case "search":
      return "Searching for recovery options…";
    case "preview":
      return "Staging the exact change…";
    case "apply":
      return `Confirming with ${provider}…`;
    case "status":
      return `Refetching the booking from the ${provider}…`;
    default:
      return "";
  }
}

const swallow = () => {
  // Every failure is already in state.error; the notice renders it.
};

export function Dashboard() {
  const state = useAppState();
  const phase = derivePhase(state);
  const { trip, disruption, search, preview, result, verification, error, busy, providerMode } = state;
  const [editingLimits, setEditingLimits] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    refresh({ source: "ui" }).catch(swallow);
  }, []);

  const liveMessage = busyMessage(busy, providerMode);

  let content: ReactNode = null;
  switch (phase) {
    case "loading":
      content = <LoadingSkeleton />;
      break;
    case "no_order":
      content = <IntroCard busy={busy} providerMode={providerMode} />;
      break;
    case "booked":
      content = trip ? (
        <>
          <TripCard trip={trip} />
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="primary"
              size="lg"
              busy={busy === "disrupt"}
              busyLabel="Simulating…"
              disabled={busy !== null}
              onClick={() => {
                disrupt().catch(swallow);
              }}
            >
              Simulate airline change
            </Button>
            <p className="max-w-md text-sm text-ink-2">Asks the provider to push this sandbox flight back, the way a real airline schedule change would. Nothing real moves.</p>
          </div>
        </>
      ) : null;
      break;
    case "disrupted":
      content = trip ? (
        <>
          {disruption ? <DisruptionBanner disruption={disruption} /> : null}
          <TripCard trip={trip} />
          <ConstraintForm trip={trip} search={null} busy={busy} editing={editingLimits} onEditingChange={setEditingLimits} />
        </>
      ) : null;
      break;
    case "options":
      content =
        trip && search ? (
          <>
            {disruption ? <DisruptionBanner disruption={disruption} /> : null}
            <TripCard trip={trip} />
            <ConstraintForm trip={trip} search={search} busy={busy} editing={editingLimits} onEditingChange={setEditingLimits} />
            <RecoveryOptions search={search} busy={busy} onEditLimits={() => setEditingLimits(true)} />
          </>
        ) : null;
      break;
    case "preview":
    case "applying":
      content = preview ? (
        <>
          {disruption ? <DisruptionBanner disruption={disruption} compact /> : null}
          <ChangePreview preview={preview} search={search} busy={busy} providerMode={providerMode} />
          {search ? <RecoveryOptions search={search} busy={busy} collapsed onEditLimits={() => setEditingLimits(true)} /> : null}
        </>
      ) : null;
      break;
    case "verified":
      content =
        result && trip ? (
          <>
            <VerifiedCard result={result} verification={verification} busy={busy} providerMode={providerMode} />
            <TripCard trip={trip} heading="Your booking now" />
          </>
        ) : null;
      break;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col" data-phase={phase}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-ctl focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to main content
      </a>

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="inline-flex">
              <svg width="26" height="26" viewBox="0 0 24 24" focusable="false">
                <rect width="24" height="24" rx="6" fill="var(--accent)" />
                <path
                  d="M5.5 16c3.6 0 5.2-2.2 6.6-4.6C13.5 9 15 6.8 18.5 6.8M15 6.8h3.5v3.5"
                  stroke="var(--on-accent)"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h1 className="text-lg font-semibold tracking-tight">TripRescue</h1>
            <span className="hidden text-sm text-ink-2 md:inline">Flight recovery you and your browser agent share</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProviderBadge />
            <WebMcpIndicator />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Stepper phase={phase} />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-5" aria-busy={busy !== null || undefined}>
            <p role="status" aria-live="polite" className={liveMessage ? "flex items-center gap-2 text-sm text-ink-2" : "sr-only"}>
              {liveMessage ? <Spinner /> : null}
              {liveMessage}
            </p>
            {error ? <ErrorNotice error={error} busy={busy} /> : null}
            {content}
          </div>
          <aside className="min-w-0 lg:sticky lg:top-6" aria-label="Agent activity">
            <ToolAuditLog />
          </aside>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-[1100px] px-4 py-6 text-xs text-ink-3 sm:px-6">
        TripRescue is a demo for the WebMCP challenge. Every booking here is a Duffel test-mode order or a local fixture: no real flights, no real money.
      </footer>

      <ConfirmationDialog />
      <WebMcpRegistry />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading your sandbox trip…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="skeleton h-44" />
        <div className="skeleton h-12 w-56" />
      </div>
    </div>
  );
}

function IntroCard({ busy, providerMode }: { busy: string | null; providerMode: ProviderMode | null }) {
  const locked = busy !== null;
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="intro-heading">
      <h2 id="intro-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Recover a disrupted flight without leaving the page
      </h2>
      <p className="mt-3 max-w-prose text-ink-2">
        {providerMode === "fixture"
          ? "This demo creates a fixture booking, LHR → LTN on Duffel Airways, then simulates an airline schedule change. No network, no real flights, no real money."
          : "This demo creates a real Duffel test-mode booking, LHR → LTN on Duffel Airways, then simulates an airline schedule change. No real flights, no real money."}
      </p>
      <p className="mt-2 text-sm text-ink-3">The route is fixed by Duffel’s test scenario.</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button
          variant="primary"
          size="lg"
          busy={busy === "seed"}
          busyLabel="Creating sandbox trip…"
          disabled={locked}
          onClick={() => {
            seed(false).catch(swallow);
          }}
        >
          Create sandbox trip
        </Button>
        <p className="max-w-sm text-sm text-ink-2">A browser agent can run every later step through this page’s site tools, except the final confirm.</p>
      </div>
    </section>
  );
}
