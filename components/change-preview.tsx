"use client";

import { applyViaUi, search as runSearch } from "@/lib/client/store";
import type { ChangePreview as ChangePreviewData, ProviderMode, RecoverySearchResult } from "@/lib/types";
import { ChangeComparison, PriceBreakdown } from "./change-comparison";
import { relativeExpiry } from "./format";
import { Button, Icon } from "./ui";
import { useNow } from "./use-now";

type Props = {
  preview: ChangePreviewData;
  search: RecoverySearchResult | null;
  busy: string | null;
  providerMode: ProviderMode | null;
};

export function ChangePreview({ preview, search, busy, providerMode }: Props) {
  const now = useNow();
  const expiry = relativeExpiry(preview.expiresAt, now);
  const applying = busy === "apply";
  const locked = busy !== null;

  return (
    <section className="card overflow-hidden" aria-labelledby="preview-heading" data-preview-id={preview.previewId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-surface-2/60 px-5 py-4 sm:px-6">
        <div>
          <h2 id="preview-heading" className="text-xl font-semibold tracking-tight">
            Review the change
          </h2>
          <p className="text-sm text-ink-2">The exact itinerary and price. Nothing is booked yet.</p>
        </div>
        <p className={`flex items-center gap-1.5 text-sm ${expiry.expired ? "font-medium text-alert-ink" : "text-ink-2"}`} aria-live="polite">
          <Icon name="clock" size={14} />
          {expiry.expired ? "This offer has expired" : `Offer expires in ${expiry.label}`}
        </p>
      </div>

      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <ChangeComparison before={preview.before} after={preview.after} />
        <PriceBreakdown fareDelta={preview.fareDelta} penalty={preview.penalty} totalCost={preview.totalCost} providerMode={providerMode} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            busy={applying}
            busyLabel="Confirming…"
            disabled={locked || expiry.expired}
            onClick={() => {
              applyViaUi(preview.previewId).catch(() => {
                // Surfaced through state.error.
              });
            }}
          >
            Review and confirm change
          </Button>
          <Button
            variant="ghost"
            disabled={locked}
            onClick={() => {
              runSearch(search?.constraints ?? {}).catch(() => {
                // Surfaced through state.error.
              });
            }}
          >
            Discard preview
          </Button>
          <p className="text-sm text-ink-2">
            {expiry.expired ? "Discard this preview and pick the option again." : "You confirm in the next step, on this page."}
          </p>
        </div>
      </div>
    </section>
  );
}
