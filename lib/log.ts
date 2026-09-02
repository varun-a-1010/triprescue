import { randomUUID } from "node:crypto";

const REDACT_KEY_RE = /(token|authorization|cookie|secret|passenger|email|phone|given_name|family_name|born_on|payment)/i;

export type LogFields = Record<string, unknown>;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY_RE.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && /^duffel_(test|live)_/.test(value)) return "[redacted]";
  return value;
}

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Structured, redacted, single-line JSON logs. */
export function log(event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...(redact(fields) as object) });
  if (process.env.NODE_ENV === "test") return;
  console.log(line);
}

export function logError(event: string, err: unknown, fields: LogFields = {}): void {
  const safe =
    err && typeof err === "object"
      ? {
          name: (err as { name?: string }).name,
          message: (err as { message?: string }).message,
          code: (err as { code?: string }).code,
        }
      : { message: String(err) };
  log(event, { ...fields, error: safe });
}
