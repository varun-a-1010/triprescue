import type { ApiEnvelope } from "../types";

export class ApiClientError extends Error {
  readonly code: string;
  readonly retrySafe: boolean;
  readonly requestId: string | null;
  readonly details?: Record<string, string | number | boolean>;

  constructor(code: string, message: string, retrySafe: boolean, requestId: string | null, details?: Record<string, string | number | boolean>) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.retrySafe = retrySafe;
    this.requestId = requestId;
    this.details = details;
  }
}

export function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

export function isAbort(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "AbortError";
}

type CallOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

/** Same-origin JSON call with the session cookie. Never sends provider ids or prices as trust. */
export async function callApi<T>(path: string, options: CallOptions = {}): Promise<{ data: T; requestId: string }> {
  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
      signal: options.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiClientError("PROVIDER_UNAVAILABLE", "Could not reach TripRescue. Check your connection and retry.", true, null);
  }
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError("INTERNAL", `Unexpected response (${response.status}).`, false, null);
  }
  if (!envelope.ok) {
    throw new ApiClientError(envelope.error.code, envelope.error.message, envelope.error.retrySafe, envelope.requestId, envelope.error.details);
  }
  return { data: envelope.data, requestId: envelope.requestId };
}
