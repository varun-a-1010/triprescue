import "server-only";
import { randomBytes } from "node:crypto";
import type { ProviderMode } from "./types";

export type AppEnv = {
  providerMode: ProviderMode;
  duffelToken: string | null;
  sessionSecret: string;
  isProduction: boolean;
};

let cached: AppEnv | null = null;
let warnedEphemeralSecret = false;

/**
 * Validates environment once per process. Refuses to start the Duffel
 * adapter with anything but a test-mode token. Never reads NEXT_PUBLIC_*.
 */
export function getEnv(): AppEnv {
  if (cached) return cached;

  for (const key of Object.keys(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_") && /DUFFEL/i.test(key)) {
      throw new Error(`Refusing to start: ${key} would expose a Duffel value to the browser.`);
    }
  }

  const isProduction = process.env.NODE_ENV === "production";
  const rawMode = (process.env.TRIPRESCUE_PROVIDER ?? "fixture").trim().toLowerCase();
  if (rawMode !== "duffel" && rawMode !== "fixture") {
    throw new Error(`TRIPRESCUE_PROVIDER must be "duffel" or "fixture" (got ${JSON.stringify(rawMode)})`);
  }
  const providerMode: ProviderMode = rawMode;

  let duffelToken: string | null = null;
  if (providerMode === "duffel") {
    const token = process.env.DUFFEL_ACCESS_TOKEN?.trim() ?? "";
    if (!token) throw new Error("TRIPRESCUE_PROVIDER=duffel requires DUFFEL_ACCESS_TOKEN");
    if (!token.startsWith("duffel_test_")) {
      throw new Error("Refusing to start: DUFFEL_ACCESS_TOKEN is not a Duffel test-mode token (expected duffel_test_ prefix)");
    }
    duffelToken = token;
  }

  let sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
  if (sessionSecret.length < 32) {
    if (isProduction) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production");
    }
    sessionSecret = randomBytes(32).toString("hex");
    if (!warnedEphemeralSecret) {
      warnedEphemeralSecret = true;
      console.warn("[triprescue] SESSION_SECRET missing or short; using an ephemeral dev secret (sessions reset on restart)");
    }
  }

  cached = { providerMode, duffelToken, sessionSecret, isProduction };
  return cached;
}

/** Test hook: clear the cache so a test can vary env vars. */
export function resetEnvForTests(): void {
  cached = null;
}
