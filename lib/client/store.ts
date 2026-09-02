import { useSyncExternalStore } from "react";
import type {
  ChangePreview,
  ChangeResult,
  DisruptResult,
  DisruptionSummary,
  ProviderMode,
  RecoveryPreferences,
  RecoverySearchResult,
  SeedResult,
  StatusResult,
  TripState,
  TripSummary,
  Verification,
} from "../types";
import { ApiClientError, callApi, isAbort, isApiClientError } from "./api";

/**
 * One client-side store shared by the visible UI and the WebMCP tools. Every
 * action updates visible state BEFORE it resolves, so a traveller and an agent
 * always look at the same thing.
 */

export type AuditSource = "ui" | "agent";
export type AuditStatus = "started" | "ok" | "error" | "cancelled";
export type AuditEvent = {
  id: string;
  at: string;
  source: AuditSource;
  tool: string;
  purpose: string;
  status: AuditStatus;
  requestId?: string;
  message?: string;
};

export type WebMcpStatus = "checking" | "unsupported" | "registered" | "error";

export type AppErrorView = { code: string; message: string; retrySafe: boolean; requestId: string | null };

export type ApprovalRequest = {
  previewId: string;
  preview: ChangePreview;
  source: AuditSource;
  /** Resolves with the apply result, "cancelled", or rejects with the apply error */
  settle: (outcome: ChangeResult | "cancelled") => void;
  fail: (err: unknown) => void;
  promise: Promise<ChangeResult | "cancelled">;
};

export type AppState = {
  ready: boolean;
  busy: string | null;
  providerMode: ProviderMode | null;
  trip: TripSummary | null;
  disruption: DisruptionSummary | null;
  search: RecoverySearchResult | null;
  preview: ChangePreview | null;
  result: ChangeResult | null;
  verification: Verification | null;
  error: AppErrorView | null;
  approval: ApprovalRequest | null;
  webmcp: WebMcpStatus;
  audit: AuditEvent[];
};

export type Phase = "loading" | "no_order" | "booked" | "disrupted" | "options" | "preview" | "applying" | "verified";

const initial: AppState = {
  ready: false,
  busy: null,
  providerMode: null,
  trip: null,
  disruption: null,
  search: null,
  preview: null,
  result: null,
  verification: null,
  error: null,
  approval: null,
  webmcp: "checking",
  audit: [],
};

let state: AppState = initial;
const listeners = new Set<() => void>();
const idempotencyKeys = new Map<string, string>();

function emit(): void {
  for (const l of listeners) l();
}

function set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  emit();
}

export function getState(): AppState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState, () => initial);
}

export function derivePhase(s: AppState): Phase {
  if (!s.ready) return "loading";
  if (!s.trip) return "no_order";
  if (s.busy === "apply") return "applying";
  if (s.result) return "verified";
  if (s.preview) return "preview";
  if (s.search) return "options";
  if (s.disruption) return "disrupted";
  return "booked";
}

function randomId(prefix: string): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, "x");
  return `${prefix}_${b64.slice(0, 12)}`;
}

// --- audit -----------------------------------------------------------------

export function audit(source: AuditSource, tool: string, purpose: string): {
  ok: (requestId?: string, message?: string) => void;
  error: (message: string, requestId?: string) => void;
  cancelled: (message?: string) => void;
} {
  const id = randomId("evt");
  const push = (status: AuditStatus, extra: Partial<AuditEvent> = {}) =>
    set((s) => ({
      audit: [{ id: `${id}_${status}`, at: new Date().toISOString(), source, tool, purpose, status, ...extra }, ...s.audit].slice(0, 60),
    }));
  push("started");
  return {
    ok: (requestId, message) => push("ok", { requestId, message }),
    error: (message, requestId) => push("error", { message, requestId }),
    cancelled: (message) => push("cancelled", { message }),
  };
}

function toErrorView(err: unknown): AppErrorView {
  if (isApiClientError(err)) return { code: err.code, message: err.message, retrySafe: err.retrySafe, requestId: err.requestId };
  if (isAbort(err)) return { code: "ABORTED", message: "Cancelled.", retrySafe: true, requestId: null };
  return { code: "INTERNAL", message: err instanceof Error ? err.message : "Unexpected error.", retrySafe: false, requestId: null };
}

function applyTripState(t: TripState): Partial<AppState> {
  return { trip: t.trip, disruption: t.disruption, preview: t.preview, providerMode: t.providerMode, ready: true };
}

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (state.busy) throw new ApiClientError("BUSY", `Another action (${state.busy}) is still running.`, true, null);
  set({ busy: name, error: null });
  try {
    return await fn();
  } catch (err) {
    if (!isAbort(err)) set({ error: toErrorView(err) });
    throw err;
  } finally {
    set({ busy: null });
  }
}

export function clearError(): void {
  set({ error: null });
}

export function setWebMcpStatus(status: WebMcpStatus): void {
  set({ webmcp: status });
}

// --- actions ---------------------------------------------------------------

export type ActionOptions = { source: AuditSource; signal?: AbortSignal };

export async function refresh(opts: ActionOptions = { source: "ui" }): Promise<TripState | null> {
  const a = audit(opts.source, "get_trip", "Read current sandbox trip");
  try {
    const { data, requestId } = await callApi<TripState>("/api/trip", { signal: opts.signal });
    set(applyTripState(data));
    a.ok(requestId);
    return data;
  } catch (err) {
    if (isApiClientError(err) && err.code === "NO_DEMO_ORDER") {
      set({ ready: true, trip: null, disruption: null, preview: null, search: null, result: null, verification: null });
      a.ok(err.requestId ?? undefined, "No sandbox trip yet");
      return null;
    }
    if (isAbort(err)) a.cancelled();
    else a.error(toErrorView(err).message);
    set({ ready: true, error: isAbort(err) ? null : toErrorView(err) });
    throw err;
  }
}

export async function seed(forceNew: boolean, opts: ActionOptions = { source: "ui" }): Promise<SeedResult> {
  const a = audit(opts.source, "seed", forceNew ? "Create a fresh sandbox trip" : "Create sandbox trip");
  return run("seed", async () => {
    try {
      const { data, requestId } = await callApi<SeedResult>("/api/demo/seed", { method: "POST", body: { forceNew }, signal: opts.signal });
      set({ ...applyTripState(data), search: null, result: null, verification: null });
      a.ok(requestId, data.status === "existing" ? "Existing sandbox trip" : "Sandbox order created");
      return data;
    } catch (err) {
      if (isAbort(err)) a.cancelled();
      else a.error(toErrorView(err).message, isApiClientError(err) ? err.requestId ?? undefined : undefined);
      throw err;
    }
  });
}

export async function disrupt(opts: ActionOptions = { source: "ui" }): Promise<DisruptResult> {
  const a = audit(opts.source, "disrupt", "Simulate airline schedule change");
  return run("disrupt", async () => {
    try {
      const { data, requestId } = await callApi<DisruptResult>("/api/demo/disrupt", { method: "POST", signal: opts.signal });
      set({ ...applyTripState(data), search: null, result: null, verification: null });
      a.ok(requestId, data.status === "already_triggered" ? "Already simulated for this trip" : "Simulated change created");
      return data;
    } catch (err) {
      if (isAbort(err)) a.cancelled();
      else a.error(toErrorView(err).message, isApiClientError(err) ? err.requestId ?? undefined : undefined);
      throw err;
    }
  });
}

export async function search(prefs: RecoveryPreferences, opts: ActionOptions = { source: "ui" }): Promise<RecoverySearchResult> {
  const a = audit(opts.source, "find_recovery_options", "Search ranked change options");
  return run("search", async () => {
    try {
      const { data, requestId } = await callApi<RecoverySearchResult>("/api/recovery/search", { method: "POST", body: prefs, signal: opts.signal });
      set({ search: data, preview: null, result: null, verification: null });
      a.ok(requestId, `${data.options.length} eligible option${data.options.length === 1 ? "" : "s"}`);
      return data;
    } catch (err) {
      if (isAbort(err)) a.cancelled();
      else a.error(toErrorView(err).message, isApiClientError(err) ? err.requestId ?? undefined : undefined);
      throw err;
    }
  });
}

export async function preview(searchId: string, optionKey: string, opts: ActionOptions = { source: "ui" }): Promise<ChangePreview> {
  const a = audit(opts.source, "preview_trip_change", "Stage one option and show exact change");
  return run("preview", async () => {
    try {
      const { data, requestId } = await callApi<ChangePreview>("/api/recovery/preview", {
        method: "POST",
        body: { searchId, optionKey },
        signal: opts.signal,
      });
      set({ preview: data, result: null, verification: null });
      a.ok(requestId, `Total ${data.totalCost.amount} ${data.totalCost.currency}`);
      return data;
    } catch (err) {
      if (isApiClientError(err) && (err.code === "TRIP_CHANGED" || err.code === "OFFER_EXPIRED")) {
        set({ search: null, preview: null });
      }
      if (isAbort(err)) a.cancelled();
      else a.error(toErrorView(err).message, isApiClientError(err) ? err.requestId ?? undefined : undefined);
      throw err;
    }
  });
}

export async function status(opts: ActionOptions = { source: "ui" }): Promise<StatusResult> {
  const a = audit(opts.source, "get_change_status", "Refetch booking and verify change");
  try {
    const { data, requestId } = await callApi<StatusResult>("/api/recovery/status", { signal: opts.signal });
    set({ ...applyTripState(data), verification: data.verification });
    a.ok(requestId, data.verification.applied ? (data.verification.verified ? "Change verified" : "Change NOT verified") : "No change applied");
    return data;
  } catch (err) {
    if (isAbort(err)) a.cancelled();
    else a.error(toErrorView(err).message, isApiClientError(err) ? err.requestId ?? undefined : undefined);
    if (!isAbort(err)) set({ error: toErrorView(err) });
    throw err;
  }
}

/** The consequential write. Only ever called from a confirmed approval. */
async function applyConfirmed(previewId: string, source: AuditSource, signal?: AbortSignal): Promise<ChangeResult> {
  const a = audit(source, "apply_trip_change", "Confirm staged change with provider");
  let idempotencyKey = idempotencyKeys.get(previewId);
  if (!idempotencyKey) {
    idempotencyKey = randomId("idem");
    idempotencyKeys.set(previewId, idempotencyKey);
  }
  return run("apply", async () => {
    try {
      const { data, requestId } = await callApi<ChangeResult>("/api/recovery/apply", {
        method: "POST",
        body: { previewId, idempotencyKey },
        signal,
      });
      set({ result: data, preview: null, search: null });
      a.ok(requestId, data.verified ? `${data.status}, verified` : `${data.status}, NOT verified`);
      // Refresh the trip card from the provider so the visible itinerary is the refetched one.
      try {
        await status({ source });
      } catch {
        // status errors are already surfaced in state
      }
      return data;
    } catch (err) {
      if (isApiClientError(err) && (err.code === "PREVIEW_EXPIRED" || err.code === "TRIP_CHANGED")) {
        set({ preview: null });
      }
      if (isAbort(err)) a.cancelled();
      else a.error(toErrorView(err).message, isApiClientError(err) ? err.requestId ?? undefined : undefined);
      throw err;
    }
  });
}

/**
 * Opens the visible confirmation dialog for the current preview. Returns a
 * request whose promise settles when the traveller decides. The dialog's
 * Confirm button is the ONLY path to applyConfirmed.
 */
export function requestApproval(previewId: string, source: AuditSource): ApprovalRequest {
  if (state.approval) return state.approval;
  const current = state.preview;
  if (!current || current.previewId !== previewId) {
    throw new ApiClientError("PREVIEW_EXPIRED", "That preview is not the one currently shown on the page.", true, null);
  }
  let settle!: ApprovalRequest["settle"];
  let fail!: ApprovalRequest["fail"];
  const promise = new Promise<ChangeResult | "cancelled">((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const approval: ApprovalRequest = { previewId, preview: current, source, settle, fail, promise };
  set({ approval, error: null });
  audit(source, "approval", "Waiting for traveller confirmation").ok(undefined, "Dialog opened");
  return approval;
}

export async function confirmApproval(): Promise<void> {
  const approval = state.approval;
  if (!approval) return;
  if (state.busy === "apply") return; // double-click guard
  try {
    const result = await applyConfirmed(approval.previewId, approval.source);
    set({ approval: null });
    approval.settle(result);
  } catch (err) {
    set({ approval: null });
    approval.fail(err);
  }
}

export function cancelApproval(reason = "Cancelled by traveller"): void {
  const approval = state.approval;
  if (!approval) return;
  if (state.busy === "apply") return; // too late to cancel: the write is in flight
  set({ approval: null });
  audit(approval.source, "approval", "Confirmation dialog").cancelled(reason);
  approval.settle("cancelled");
}

/** Manual UI path: open the dialog and wait for the decision. */
export async function applyViaUi(previewId: string): Promise<ChangeResult | "cancelled"> {
  return requestApproval(previewId, "ui").promise;
}

export async function reset(): Promise<void> {
  const a = audit("ui", "reset", "Start over with a fresh sandbox trip");
  try {
    await seed(true);
    a.ok(undefined, "Fresh sandbox trip");
  } catch (err) {
    a.error(toErrorView(err).message);
    throw err;
  }
}

/** Test-only: reset module state. */
export function __resetStoreForTests(): void {
  state = initial;
  idempotencyKeys.clear();
  emit();
}
