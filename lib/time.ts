/**
 * Time helpers. Provider APIs hand us airport-local wall-clock times; we
 * convert them to ISO 8601 with an explicit offset so every comparison is on
 * absolute instants and never on formatted local strings.
 */

export const ISO_WITH_OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function hasOffset(iso: string): boolean {
  return ISO_WITH_OFFSET_RE.test(iso);
}

function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - utcMs) / 60000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatWithOffset(utcMs: number, offsetMin: number): string {
  const local = new Date(utcMs + offsetMin * 60000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * Convert a naive local datetime (e.g. "2026-10-17T10:00:00") in an IANA zone
 * to ISO 8601 with offset. Inputs that already carry an offset are returned
 * unchanged.
 */
export function localToIso(local: string, timeZone: string): string {
  if (hasOffset(local)) return local;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) {
    throw new Error(`Unrecognized local datetime: ${JSON.stringify(local)}`);
  }
  const naive = Date.parse(local.length === 16 ? `${local}:00Z` : `${local}Z`);
  let offset = tzOffsetMinutes(naive, timeZone);
  let utc = naive - offset * 60000;
  const second = tzOffsetMinutes(utc, timeZone);
  if (second !== offset) {
    offset = second;
    utc = naive - offset * 60000;
  }
  return formatWithOffset(utc, offset);
}

export function parseInstant(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Invalid instant: ${JSON.stringify(iso)}`);
  return ms;
}

export function compareInstants(a: string, b: string): -1 | 0 | 1 {
  const x = parseInstant(a);
  const y = parseInstant(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isBefore(a: string, b: string): boolean {
  return compareInstants(a, b) < 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(parseInstant(iso) + minutes * 60000).toISOString();
}

export function minInstant(a: string, b: string): string {
  return compareInstants(a, b) <= 0 ? a : b;
}

/** YYYY-MM-DD local date portion of an ISO string with offset */
export function localDateOf(isoWithOffset: string): string {
  return isoWithOffset.slice(0, 10);
}

/** A future date string (YYYY-MM-DD) `days` ahead of now, in UTC */
export function futureDate(days: number, from = new Date()): string {
  const d = new Date(from.getTime() + days * 86400000);
  return d.toISOString().slice(0, 10);
}
