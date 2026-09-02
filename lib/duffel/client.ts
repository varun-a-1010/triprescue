import "server-only";
import { Duffel } from "@duffel/api";

let client: Duffel | null = null;

/** Server-only Duffel client. The token never leaves this module. */
export function createDuffelClient(token: string): Duffel {
  if (!client) {
    client = new Duffel({ token, source: "triprescue-webmcp-demo" });
  }
  return client;
}
