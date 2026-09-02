"use client";

import { useEffect, useId, useRef, type MouseEvent, type SyntheticEvent } from "react";
import { cancelApproval, confirmApproval, getState, useAppState } from "@/lib/client/store";
import { ChangeComparison, PriceBreakdown } from "./change-comparison";
import { flightsLabel, localDateTime, relativeExpiry, stopsLabel } from "./format";
import { ProviderBadge } from "./provider-badge";
import { Button, Icon } from "./ui";
import { useNow } from "./use-now";

/**
 * The only door to the consequential write. A native <dialog> opened with
 * showModal() whenever the store holds an approval request, whether the
 * traveller or a browser agent asked for it. Escape and backdrop cancel;
 * neither can close it while the write is in flight.
 */
export function ConfirmationDialog() {
  const { approval, busy, providerMode } = useAppState();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const now = useNow();
  const open = approval !== null;
  const applying = busy === "apply";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function onCancelEvent(e: SyntheticEvent<HTMLDialogElement>) {
    // Escape: keep control of closing so an in-flight write is never orphaned.
    e.preventDefault();
    if (getState().busy !== "apply") cancelApproval();
  }

  function onBackdropClick(e: MouseEvent<HTMLDialogElement>) {
    if (e.target !== e.currentTarget) return;
    if (getState().busy !== "apply") cancelApproval();
  }

  function onClose() {
    if (getState().approval && getState().busy !== "apply") cancelApproval("Dialog closed");
    const el = returnFocus.current;
    returnFocus.current = null;
    el?.focus();
  }

  const preview = approval?.preview ?? null;
  const expiry = preview ? relativeExpiry(preview.expiresAt, now) : null;
  const providerLabel = providerMode === "fixture" ? "fixture provider" : "Duffel sandbox";

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-busy={applying || undefined}
      onCancel={onCancelEvent}
      onClick={onBackdropClick}
      onClose={onClose}
    >
      {approval && preview && expiry ? (
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <header>
            <ProviderBadge />
            <h2 id={titleId} className="mt-3 text-xl font-semibold tracking-tight">
              Confirm sandbox booking change
            </h2>
            <p id={descId} className="mt-1 text-sm text-ink-2">
              This is the only step that changes the booking. Check the exact itinerary and total below.
            </p>
            {approval.source === "agent" ? (
              <p className="mt-3 flex items-start gap-2 rounded-ctl border border-sandbox/40 bg-sandbox-soft px-3 py-2 text-sm text-sandbox-ink">
                <Icon name="agent" size={16} className="mt-0.5 shrink-0" />
                <span>Requested by your browser agent — nothing is booked until you confirm here.</span>
              </p>
            ) : null}
          </header>

          <ChangeComparison before={preview.before} after={preview.after} size="sm" />

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ink-2">Flights</dt>
              <dd className="tabular-nums text-ink">
                <span className="line-through decoration-ink-3">{flightsLabel(preview.before)}</span>
                <span className="mx-1.5 text-ink-3" aria-hidden="true">
                  →
                </span>
                <span className="sr-only">becomes</span>
                <span className="font-medium">{flightsLabel(preview.after)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Stops</dt>
              <dd className="text-ink">{stopsLabel(preview.after)}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Offer expires</dt>
              <dd className={expiry.expired ? "font-medium text-alert-ink" : "text-ink"}>
                {localDateTime(preview.expiresAt)} {expiry.expired ? "(expired)" : `(in ${expiry.label})`}
              </dd>
            </div>
          </dl>

          <PriceBreakdown fareDelta={preview.fareDelta} penalty={preview.penalty} totalCost={preview.totalCost} providerMode={providerMode} />

          <p role="status" aria-live="polite" className={`text-sm ${applying ? "flex items-center gap-2 text-ink-2" : expiry.expired ? "text-alert-ink" : "sr-only"}`}>
            {applying ? `Confirming with ${providerLabel}…` : expiry.expired ? "This offer has expired. Cancel, then preview the option again." : ""}
          </p>

          <footer className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button ref={cancelRef} variant="secondary" size="lg" disabled={applying} onClick={() => cancelApproval()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              busy={applying}
              busyLabel="Confirming…"
              disabled={expiry.expired}
              onClick={() => {
                void confirmApproval();
              }}
            >
              Confirm sandbox booking change
            </Button>
          </footer>
        </div>
      ) : null}
    </dialog>
  );
}
