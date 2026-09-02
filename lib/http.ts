import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { ZodType } from "zod";
import { AppError, isAbortError, isAppError } from "./errors";
import { mapDuffelError } from "./duffel/errors";
import { log, logError, newRequestId } from "./log";
import { getProvider } from "./providers";
import type { ServiceCtx } from "./recovery/service";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, newSession, openSession, sealSession, sessionHash } from "./session";
import type { ApiEnvelope } from "./types";

type RouteOptions<I> = {
  name: string;
  mutating: boolean;
  schema?: ZodType<I>;
};

function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || req.nextUrl.host;
  return `${proto}://${host}`;
}

function isSecure(req: NextRequest): boolean {
  return requestOrigin(req).startsWith("https://");
}

/** Strict same-origin check for every mutating route (CSRF guard). */
function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (origin) {
    if (origin !== requestOrigin(req)) {
      throw new AppError("FORBIDDEN_ORIGIN", "Cross-origin requests are not accepted.");
    }
    return;
  }
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError("FORBIDDEN_ORIGIN", "Cross-site requests are not accepted.");
  }
}

async function parseInput<I>(req: NextRequest, opts: RouteOptions<I>): Promise<I> {
  let body: unknown = {};
  if (opts.mutating) {
    const text = await req.text();
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppError("INVALID_INPUT", "Request body must be valid JSON.");
      }
    }
  }
  if (!opts.schema) return body as I;
  const parsed = opts.schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError("INVALID_INPUT", first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.", {
      details: { path: first?.path.join(".") ?? "" },
    });
  }
  return parsed.data;
}

function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (isAbortError(err)) return new AppError("ABORTED", "The request was cancelled.");
  if (err && typeof err === "object" && ("errors" in err || "meta" in err)) return mapDuffelError(err, "unknown");
  return new AppError("INTERNAL", "Something went wrong on our side. Your booking was not changed.", { cause: err });
}

/**
 * Wraps a service call with: request id, origin check, input validation,
 * session load/persist, error envelope, and structured logging.
 */
export function defineRoute<I, O>(opts: RouteOptions<I>, handler: (ctx: ServiceCtx, input: I) => Promise<O>) {
  return async function route(req: NextRequest): Promise<Response> {
    const requestId = newRequestId();
    const started = Date.now();
    const cookieStore = await cookies();
    const original = openSession(cookieStore.get(SESSION_COOKIE)?.value);
    const ctx: ServiceCtx = { provider: getProvider(), session: original ?? newSession(), requestId };
    const before = JSON.stringify(ctx.session);

    let envelope: ApiEnvelope<O>;
    let httpStatus = 200;
    try {
      if (opts.mutating) assertSameOrigin(req);
      const input = await parseInput(req, opts);
      const data = await handler(ctx, input);
      envelope = { ok: true, data, requestId };
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.code === "INTERNAL") logError("route.internal_error", err, { requestId, route: opts.name });
      envelope = { ok: false, error: appErr.toJSON(), requestId };
      httpStatus = appErr.status;
    }

    if (JSON.stringify(ctx.session) !== before || !original) {
      cookieStore.set(SESSION_COOKIE, sealSession(ctx.session), {
        httpOnly: true,
        sameSite: "lax",
        // Secure follows the request scheme (x-forwarded-proto behind a proxy) so
        // local http testing still gets a cookie while https deployments get Secure.
        secure: isSecure(req),
        path: "/",
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
    }

    log("route", {
      requestId,
      route: opts.name,
      ok: envelope.ok,
      code: envelope.ok ? null : envelope.error.code,
      status: httpStatus,
      ms: Date.now() - started,
      session: sessionHash(ctx.session),
      provider: ctx.provider.mode,
    });
    return Response.json(envelope, { status: httpStatus, headers: { "cache-control": "no-store" } });
  };
}
