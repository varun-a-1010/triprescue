import { AppError, isAbortError, isAppError, type ErrorCode } from "../errors";
import { log } from "../log";

type DuffelLikeError = {
  meta?: { status?: number; request_id?: string };
  errors?: Array<{ code?: string; type?: string; title?: string }>;
  message?: string;
  name?: string;
};

function asDuffelLike(err: unknown): DuffelLikeError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as DuffelLikeError;
  if (Array.isArray(e.errors) || e.meta) return e;
  return null;
}

/**
 * Maps a Duffel SDK failure to a stable application error. Only the
 * provider's error *code*, *type* and HTTP status are logged — never the
 * response body, headers, or any request payload.
 */
export function mapDuffelError(err: unknown, op: string, notFoundCode: ErrorCode = "PROVIDER_UNAVAILABLE"): AppError {
  if (isAppError(err)) return err;
  if (isAbortError(err)) return new AppError("ABORTED", "The request was cancelled.");

  const d = asDuffelLike(err);
  const status = d?.meta?.status;
  const first = d?.errors?.[0];
  const code = first?.code ?? "unknown";
  const type = first?.type ?? "unknown";

  log("duffel.error", { op, status: status ?? null, providerCode: code, providerType: type, duffelRequestId: d?.meta?.request_id ?? null });

  if (status === 429) {
    return new AppError("RATE_LIMITED", "The sandbox provider is rate limiting requests. Wait a moment and retry.", {
      details: { op },
    });
  }
  if (/expired|no_longer_available|not_available|unavailable/i.test(code)) {
    return new AppError("OFFER_EXPIRED", "That option is no longer available from the provider.", { details: { op } });
  }
  if (/already_confirmed|already_been_confirmed/i.test(code)) {
    return new AppError("ALREADY_CONFIRMED", "This change was already confirmed.", { details: { op } });
  }
  if (status === 404 || /not_found/i.test(code)) {
    return new AppError(notFoundCode, "The provider could not find that resource.", { details: { op } });
  }
  if (!d) {
    // Network / unknown failure
    return new AppError("PROVIDER_UNAVAILABLE", "The sandbox provider could not be reached. Your booking was not changed.", {
      details: { op },
      cause: err,
    });
  }
  return new AppError("PROVIDER_UNAVAILABLE", "The sandbox provider rejected the request. Your booking was not changed.", {
    retrySafe: status === undefined || status >= 500,
    details: { op, providerCode: code, ...(status ? { status } : {}) },
    cause: err,
  });
}

function isTransient(err: unknown): boolean {
  const d = asDuffelLike(err);
  if (!d) return !isAbortError(err) && !isAppError(err);
  const status = d.meta?.status;
  return status === undefined || status >= 500 || status === 429;
}

/** Bounded retry with jitter for idempotent reads only. */
export async function withReadRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      const wait = 250 * 2 ** i + Math.floor(Math.random() * 150);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
