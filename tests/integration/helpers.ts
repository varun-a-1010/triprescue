import { expect } from "vitest";
import { AppError, isAppError, type ErrorCode } from "@/lib/errors";
import { FixtureProvider } from "@/lib/providers/fixture";
import { disrupt, preview, search, seed, type ServiceCtx } from "@/lib/recovery/service";
import { newSession, type SessionState } from "@/lib/session";
import type { ChangePreview, RecoveryPreferences, RecoverySearchResult } from "@/lib/types";

export function ctx(session: SessionState = newSession()): ServiceCtx {
  return { provider: new FixtureProvider(), session, requestId: "req_test" };
}

export async function seeded(): Promise<ServiceCtx> {
  const c = ctx();
  await seed(c, {});
  return c;
}

export async function disrupted(): Promise<ServiceCtx> {
  const c = await seeded();
  await disrupt(c);
  return c;
}

export async function searched(prefs: RecoveryPreferences = {}): Promise<{ c: ServiceCtx; result: RecoverySearchResult }> {
  const c = await disrupted();
  const result = await search(c, prefs);
  return { c, result };
}

export async function previewed(): Promise<{ c: ServiceCtx; result: RecoverySearchResult; pv: ChangePreview }> {
  const { c, result } = await searched();
  const pv = await preview(c, { searchId: result.searchId, optionKey: result.options[0].optionKey });
  return { c, result, pv };
}

/** Resolves with the AppError when `p` rejects with the expected code; fails otherwise. */
export async function expectAppError(p: Promise<unknown>, code: ErrorCode): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    if (!isAppError(err)) throw err;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected ${code} but the call resolved`);
}

/** Session-side record for one option (provider offer id + snapshot). */
export function optionRecord(c: ServiceCtx, optionKey: string) {
  const rec = c.session.search?.options[optionKey];
  if (!rec) throw new Error(`option ${optionKey} is not in the session search record`);
  return rec;
}

/** Matches any provider-shaped id (order, offer, request, change, slice, airline change). */
export const PROVIDER_ID_RE = /\b(ord|oco|ocr|ocg|sli|aic)_[A-Za-z0-9]+/;

export function localClock(iso: string): string {
  return iso.slice(11, 16);
}
