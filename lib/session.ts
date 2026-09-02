import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { getEnv } from "./env";
import type { Money, RecoveryPreferences, TripStatus } from "./types";

export const SESSION_COOKIE = "triprescue_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type SearchOptionRecord = {
  offerId: string;
  expiresAt: string;
  total: Money;
};

export type SearchRecord = {
  searchId: string;
  createdAt: string;
  expiresAt: string;
  fingerprint: string;
  prefs: RecoveryPreferences;
  currency: string;
  options: Record<string, SearchOptionRecord>;
};

export type PreviewRecord = {
  previewId: string;
  searchId: string;
  optionKey: string;
  changeId: string;
  fingerprint: string;
  total: Money;
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
};

export type AppliedRecord = {
  previewId: string;
  changeId: string;
  idempotencyKey: string;
  confirmedAt: string;
};

/**
 * Everything the app needs to know about the visitor. Lives only in an
 * encrypted, HttpOnly cookie; contains opaque provider ids and never PII,
 * tokens, or raw provider payloads.
 */
export type SessionState = {
  v: 1;
  sid: string;
  orderId?: string;
  tripStatus?: TripStatus;
  disruption?: { changeId: string; triggeredAt: string };
  search?: SearchRecord;
  preview?: PreviewRecord;
  applied?: AppliedRecord;
};

export function newSession(): SessionState {
  return { v: 1, sid: randomBytes(12).toString("base64url") };
}

export function opaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x").slice(0, 12)}`;
}

/** Short, stable, non-reversible session hash for logs. */
export function sessionHash(session: SessionState): string {
  return createHmac("sha256", getEnv().sessionSecret).update(session.sid).digest("hex").slice(0, 12);
}

/** App-scoped opaque trip id derived from the provider order id. */
export function tripIdFor(orderId: string): string {
  return `trp_${createHmac("sha256", getEnv().sessionSecret).update(orderId).digest("hex").slice(0, 12)}`;
}

function key(): Buffer {
  return createHash("sha256").update(getEnv().sessionSecret).digest();
}

export function sealSession(state: SessionState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(state), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function openSession(sealed: string | undefined | null): SessionState | null {
  if (!sealed) return null;
  try {
    const buf = Buffer.from(sealed, "base64url");
    if (buf.length < 12 + 16 + 2) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as SessionState;
    if (parsed?.v !== 1 || typeof parsed.sid !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
