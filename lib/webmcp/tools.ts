import type { ChangePreview, ChangeResult, ItinerarySummary, RecoveryOption, StatusResult, TripState } from "../types";
import { applyToolInputSchema, emptyInputSchema, previewInputSchema, recoveryPreferencesSchema, TOOL_INPUT_SCHEMAS } from "../validation";
import { isAbort, isApiClientError } from "../client/api";
import * as store from "../client/store";

/**
 * The five WebMCP tools. Each one:
 *  1. parses input with the same zod schema the route uses,
 *  2. records a visible audit event,
 *  3. calls a same-origin route through the shared store (updating the page
 *     BEFORE resolving),
 *  4. returns a compact, normalized result (never raw provider data).
 */

export const APPROVAL_WAIT_MS = 20_000;
export const MAX_AGENT_OPTIONS = 3;

type ToolResult = Record<string, unknown>;

function compactItinerary(it: ItinerarySummary) {
  return {
    stops: it.stops,
    flights: it.segments.map((s) => ({
      flight: `${s.carrierCode} ${s.flightNumber}`.trim(),
      from: s.origin,
      departsAt: s.departingAt,
      to: s.destination,
      arrivesAt: s.arrivingAt,
    })),
  };
}

function compactOption(o: RecoveryOption) {
  const last = o.itinerary.segments[o.itinerary.segments.length - 1];
  return {
    optionKey: o.optionKey,
    arrivesAt: last?.arrivingAt ?? null,
    departsAt: o.itinerary.segments[0]?.departingAt ?? null,
    stops: o.itinerary.stops,
    flights: o.itinerary.segments.map((s) => `${s.carrierCode} ${s.flightNumber} ${s.origin}-${s.destination}`),
    totalCost: `${o.totalCost.amount} ${o.totalCost.currency}`,
    penalty: `${o.penalty.amount} ${o.penalty.currency}`,
    expiresAt: o.expiresAt,
    ...(o.eligible ? {} : { ineligibleBecause: o.eligibilityReasons }),
  };
}

function compactPreview(p: ChangePreview) {
  return {
    previewId: p.previewId,
    before: compactItinerary(p.before),
    after: compactItinerary(p.after),
    totalCost: `${p.totalCost.amount} ${p.totalCost.currency}`,
    penalty: `${p.penalty.amount} ${p.penalty.currency}`,
    fareDelta: `${p.fareDelta.amount} ${p.fareDelta.currency}`,
    expiresAt: p.expiresAt,
    sandbox: true as const,
  };
}

function compactTrip(t: TripState) {
  return {
    sandbox: true as const,
    providerMode: t.providerMode,
    trip: t.trip
      ? {
          tripId: t.trip.tripId,
          providerOrderId: t.trip.providerOrderId,
          bookingReference: t.trip.bookingReference,
          currency: t.trip.currency,
          status: t.trip.status,
          changeAvailable: t.trip.changeAvailable,
          itinerary: compactItinerary(t.trip.itinerary),
        }
      : null,
    disruption: t.disruption
      ? { kind: t.disruption.kind, status: t.disruption.status, receivedAt: t.disruption.receivedAt, message: t.disruption.message }
      : null,
    stagedPreview: t.preview ? { previewId: t.preview.previewId, expiresAt: t.preview.expiresAt } : null,
  };
}

function compactResult(r: ChangeResult) {
  return {
    status: r.status,
    verified: r.verified,
    confirmedAt: r.confirmedAt,
    verifiedAt: r.verifiedAt,
    before: compactItinerary(r.before),
    after: compactItinerary(r.after),
    totalCost: `${r.totalCost.amount} ${r.totalCost.currency}`,
    sandbox: true as const,
  };
}

/** Errors become structured results so the agent can recover (never thrown as raw stacks). */
function toolError(err: unknown): ToolResult {
  if (isAbort(err)) return { ok: false, error: { code: "ABORTED", message: "The tool call was cancelled.", retrySafe: true } };
  if (isApiClientError(err)) {
    return { ok: false, error: { code: err.code, message: err.message, retrySafe: err.retrySafe, requestId: err.requestId } };
  }
  return { ok: false, error: { code: "INTERNAL", message: err instanceof Error ? err.message : "Unexpected error.", retrySafe: false } };
}

function invalid(issue: string): ToolResult {
  return { ok: false, error: { code: "INVALID_INPUT", message: issue, retrySafe: false } };
}

function firstIssue(result: { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } }): string {
  const i = result.error.issues[0];
  return i ? `${i.path.map(String).join(".") || "input"}: ${i.message}` : "Invalid input.";
}

function sleep(ms: number, signal?: AbortSignal): Promise<"timeout"> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    signal?.addEventListener("abort", () => clearTimeout(t), { once: true });
  });
}

function onAbort(signal?: AbortSignal): Promise<"aborted"> {
  return new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve("aborted");
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
}

export function buildTools(): WebMCP.ModelContextTool[] {
  return [
    {
      name: "get_trip",
      title: "Get current trip",
      description:
        "Read the current TripRescue sandbox booking, the simulated airline schedule change, and any staged recovery. Does not change the booking.",
      inputSchema: TOOL_INPUT_SCHEMAS.empty,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = emptyInputSchema.safeParse(input ?? {});
        if (!parsed.success) return invalid(firstIssue(parsed));
        try {
          const data = await store.refresh({ source: "agent", signal });
          if (!data) {
            return {
              ok: true,
              sandbox: true,
              trip: null,
              note: "No sandbox trip exists yet. Ask the traveller to click 'Create sandbox trip' on the page.",
            };
          }
          return { ok: true, ...compactTrip(data) };
        } catch (err) {
          return toolError(err);
        }
      },
    },
    {
      name: "find_recovery_options",
      title: "Find recovery options",
      description:
        "Find and rank change options for the current disrupted sandbox trip using optional arrival deadline, max extra cost, and max stops. Creates a temporary search; does not change the booked itinerary.",
      inputSchema: TOOL_INPUT_SCHEMAS.findRecoveryOptions,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = recoveryPreferencesSchema.safeParse(input ?? {});
        if (!parsed.success) return invalid(firstIssue(parsed));
        try {
          const data = await store.search(parsed.data, { source: "agent", signal });
          const options = data.options.slice(0, MAX_AGENT_OPTIONS).map(compactOption);
          const ineligible = data.ineligible.slice(0, MAX_AGENT_OPTIONS).map((o) => ({ optionKey: o.optionKey, reasons: o.eligibilityReasons }));
          return {
            ok: true,
            searchId: data.searchId,
            currency: data.currency,
            constraints: data.constraints,
            expiresAt: data.expiresAt,
            options,
            ...(options.length === 0
              ? { ineligible, note: "No option satisfies every constraint. Ask the traveller before relaxing a limit; do not exceed it silently." }
              : ineligible.length > 0
                ? { ineligible }
                : {}),
            nextStep: options.length > 0 ? "Call preview_trip_change with searchId and one optionKey to see the exact change before anything is booked." : undefined,
            sandbox: true,
          };
        } catch (err) {
          return toolError(err);
        }
      },
    },
    {
      name: "preview_trip_change",
      title: "Preview trip change",
      description:
        "Stage one option from find_recovery_options and show the exact before/after itinerary and price. Creates a temporary pending change; does not confirm it.",
      inputSchema: TOOL_INPUT_SCHEMAS.previewTripChange,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = previewInputSchema.safeParse(input ?? {});
        if (!parsed.success) return invalid(firstIssue(parsed));
        try {
          const data = await store.preview(parsed.data.searchId, parsed.data.optionKey, { source: "agent", signal });
          return {
            ok: true,
            ...compactPreview(data),
            nextStep: "Nothing is booked yet. If the traveller agrees, call apply_trip_change with this previewId; they must confirm in the page.",
          };
        } catch (err) {
          return toolError(err);
        }
      },
    },
    {
      name: "apply_trip_change",
      title: "Apply trip change",
      description:
        "Confirm the staged change for the current Duffel sandbox booking. Opens the site's confirmation dialog; the traveller must click Confirm there. Changes the sandbox booking and may use test balance payment.",
      inputSchema: TOOL_INPUT_SCHEMAS.applyTripChange,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = applyToolInputSchema.safeParse(input ?? {});
        if (!parsed.success) return invalid(firstIssue(parsed));
        let approval: store.ApprovalRequest;
        try {
          approval = store.requestApproval(parsed.data.previewId, "agent");
        } catch (err) {
          return toolError(err);
        }
        // Wait a bounded time for the human decision. Never confirm on abort.
        const outcome = await Promise.race([approval.promise.catch((err) => ({ failed: err })), sleep(APPROVAL_WAIT_MS, signal), onAbort(signal)]);
        if (outcome === "aborted") {
          store.cancelApproval("Agent call aborted");
          return { ok: false, error: { code: "ABORTED", message: "The tool call was cancelled before the traveller confirmed. Nothing was booked.", retrySafe: true } };
        }
        if (outcome === "timeout") {
          return {
            ok: true,
            status: "approval_required",
            previewId: parsed.data.previewId,
            expiresAt: approval.preview.expiresAt,
            note: "The confirmation dialog is open on the page. Nothing is booked until the traveller clicks 'Confirm sandbox booking change'. Call get_change_status afterwards to verify.",
            sandbox: true,
          };
        }
        if (outcome === "cancelled") {
          return { ok: false, error: { code: "APPROVAL_CANCELLED", message: "The traveller cancelled. Nothing was booked.", retrySafe: true } };
        }
        if (typeof outcome === "object" && outcome !== null && "failed" in outcome) {
          return toolError((outcome as { failed: unknown }).failed);
        }
        return { ok: true, ...compactResult(outcome as ChangeResult) };
      },
    },
    {
      name: "get_change_status",
      title: "Get change status",
      description:
        "Refetch the current Duffel sandbox booking and report whether the staged itinerary change was applied and verified. Does not change the booking.",
      inputSchema: TOOL_INPUT_SCHEMAS.empty,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input, { signal }) => {
        const parsed = emptyInputSchema.safeParse(input ?? {});
        if (!parsed.success) return invalid(firstIssue(parsed));
        try {
          const data: StatusResult = await store.status({ source: "agent", signal });
          const v = data.verification;
          return {
            ok: true,
            ...compactTrip(data),
            verification: {
              applied: v.applied,
              verified: v.verified,
              confirmedAt: v.confirmedAt,
              verifiedAt: v.verifiedAt,
              intended: v.intended ? compactItinerary(v.intended) : null,
            },
            awaitingApproval: store.getState().approval ? true : false,
          };
        } catch (err) {
          return toolError(err);
        }
      },
    },
  ];
}
