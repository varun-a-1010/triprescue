import { afterEach, describe, expect, it, vi } from "vitest";
import { mapDuffelError, withReadRetry } from "@/lib/duffel/errors";
import { AppError, isAppError } from "@/lib/errors";

const RAW_BODY = "Full raw response body with duffel_test_supersecret and card 4242";

function duffelErr(status: number | undefined, errors: Array<{ code?: string; type?: string; title?: string }>, extra: Record<string, unknown> = {}) {
  return { meta: status ? { status, request_id: "rq_1" } : {}, errors, message: RAW_BODY, ...extra };
}

describe("mapDuffelError", () => {
  it("maps HTTP 429 to RATE_LIMITED", () => {
    const err = mapDuffelError(duffelErr(429, [{ code: "rate_limit_exceeded" }]), "getOrder");
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retrySafe).toBe(true);
    expect(err.status).toBe(429);
    expect(err.details).toEqual({ op: "getOrder" });
  });

  it("maps offer_no_longer_available to OFFER_EXPIRED", () => {
    const err = mapDuffelError(duffelErr(422, [{ code: "offer_no_longer_available", type: "validation_error" }]), "createPendingChange");
    expect(err.code).toBe("OFFER_EXPIRED");
    expect(err.retrySafe).toBe(true);
  });

  it("maps already-confirmed codes to ALREADY_CONFIRMED", () => {
    expect(mapDuffelError(duffelErr(422, [{ code: "order_change_already_confirmed" }]), "confirmChange").code).toBe("ALREADY_CONFIRMED");
  });

  it("maps 404 to the caller-provided not-found code", () => {
    expect(mapDuffelError(duffelErr(404, [{ code: "not_found" }]), "getOrder", "NO_DEMO_ORDER").code).toBe("NO_DEMO_ORDER");
    expect(mapDuffelError(duffelErr(404, []), "getPendingChange", "PREVIEW_EXPIRED").code).toBe("PREVIEW_EXPIRED");
    // and defaults to PROVIDER_UNAVAILABLE when none is given
    expect(mapDuffelError(duffelErr(404, [{ code: "not_found" }]), "getOrder").code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("maps a plain network failure to a retry-safe PROVIDER_UNAVAILABLE", () => {
    const err = mapDuffelError(new TypeError("fetch failed"), "getOrder");
    expect(err.code).toBe("PROVIDER_UNAVAILABLE");
    expect(err.retrySafe).toBe(true);
    expect(err.status).toBe(502);
    expect(err.details).toEqual({ op: "getOrder" });
    expect(err.message).not.toContain("fetch failed");
  });

  it("marks a 4xx provider rejection as not retry-safe and a 5xx as retry-safe", () => {
    const bad = mapDuffelError(duffelErr(400, [{ code: "invalid_request", type: "validation_error" }]), "searchChangeOffers");
    expect(bad.code).toBe("PROVIDER_UNAVAILABLE");
    expect(bad.retrySafe).toBe(false);
    expect(bad.details).toEqual({ op: "searchChangeOffers", providerCode: "invalid_request", status: 400 });

    const down = mapDuffelError(duffelErr(503, [{ code: "internal_server_error" }]), "getOrder");
    expect(down.retrySafe).toBe(true);
    expect(down.details?.status).toBe(503);
  });

  it("maps an AbortError to ABORTED", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(mapDuffelError(abort, "getOrder").code).toBe("ABORTED");
  });

  it("passes an AppError through untouched", () => {
    const original = new AppError("TRIP_CHANGED", "moved", { details: { reason: "test" } });
    expect(mapDuffelError(original, "getOrder")).toBe(original);
  });

  it("never leaks the raw provider message or titles into the app error", () => {
    const raw = duffelErr(422, [{ code: "some_code", type: "some_type", title: "Raw provider title" }], { body: RAW_BODY, headers: { authorization: "Bearer duffel_test_x" } });
    const err = mapDuffelError(raw, "confirmChange");
    const surface = JSON.stringify({ json: err.toJSON(), message: err.message, details: err.details ?? null });
    for (const leak of ["Raw provider title", "duffel_test_", "4242", "Full raw response body", "Bearer", "authorization"]) {
      expect(surface, leak).not.toContain(leak);
    }
  });
});

describe("withReadRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a transient network failure and then succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce("ok");
    const p = withReadRetry(fn, 3);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 / 5xx provider response", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(duffelErr(429, [{ code: "rate_limit_exceeded" }]))
      .mockRejectedValueOnce(duffelErr(502, [{ code: "bad_gateway" }]))
      .mockResolvedValueOnce("ok");
    const p = withReadRetry(fn, 3);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the configured attempts and rethrows the last error", async () => {
    vi.useFakeTimers();
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new TypeError("fetch failed"));
    const p = withReadRetry(fn, 3);
    const assertion = expect(p).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry an AppError", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new AppError("NO_DEMO_ORDER", "gone"));
    await expect(withReadRetry(fn, 3)).rejects.toSatisfy((e) => isAppError(e) && e.code === "NO_DEMO_ORDER");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 4xx provider rejection or an abort", async () => {
    const bad = vi.fn<() => Promise<string>>().mockRejectedValue(duffelErr(400, [{ code: "invalid_request" }]));
    await expect(withReadRetry(bad, 3)).rejects.toMatchObject({ meta: { status: 400 } });
    expect(bad).toHaveBeenCalledTimes(1);

    const abort = vi.fn<() => Promise<string>>().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(withReadRetry(abort, 3)).rejects.toMatchObject({ name: "AbortError" });
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
