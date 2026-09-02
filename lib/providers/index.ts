import "server-only";
import { getEnv } from "../env";
import { createDuffelClient } from "../duffel/client";
import { DuffelProvider } from "./duffel";
import { FixtureProvider } from "./fixture";
import type { FlightRecoveryProvider } from "./types";

let duffel: DuffelProvider | null = null;
let fixture: FixtureProvider | null = null;

/** Provider is chosen ONLY by configuration. There is no runtime fallback. */
export function getProvider(): FlightRecoveryProvider {
  const env = getEnv();
  if (env.providerMode === "duffel") {
    if (!duffel) duffel = new DuffelProvider(createDuffelClient(env.duffelToken as string));
    return duffel;
  }
  if (!fixture) fixture = new FixtureProvider();
  return fixture;
}
