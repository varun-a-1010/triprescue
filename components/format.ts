import { formatMoney, isPositiveAmount } from "@/lib/money";
import { parseInstant } from "@/lib/time";
import type { ItinerarySummary, Money, SegmentSummary } from "@/lib/types";

/**
 * Presentation helpers for client components.
 *
 * Itinerary times are shown exactly as written: airport-local wall clock plus
 * the offset carried in the string. They are never converted to the viewer's
 * zone. Only system timestamps (received / confirmed / verified / audit) are
 * rendered in the viewer's local time, with the zone named.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LOCAL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

export type LocalParts = { date: string; time: string; offset: string };

export function parseLocal(iso: string): LocalParts | null {
  const m = LOCAL_ISO_RE.exec(iso);
  if (!m) return null;
  const [, y, mo, d, h, mi, off] = m;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()];
  return {
    date: `${weekday} ${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo}`,
    time: `${h}:${mi}`,
    offset: off === "Z" ? "+00:00" : (off ?? ""),
  };
}

export function localTime(iso: string): string {
  return parseLocal(iso)?.time ?? iso;
}

export function localDate(iso: string): string {
  return parseLocal(iso)?.date ?? iso.slice(0, 10);
}

export function localDateTime(iso: string): string {
  const p = parseLocal(iso);
  return p ? `${p.date}, ${p.time}` : iso;
}

/** The UTC offset written in the string, e.g. "+01:00". */
export function offsetOf(iso: string): string {
  return parseLocal(iso)?.offset || "+00:00";
}

/** Value for a datetime-local input: the wall-clock part, offset dropped. */
export function toDatetimeLocalValue(iso: string): string {
  return LOCAL_ISO_RE.test(iso) ? iso.slice(0, 16) : "";
}

/** A system instant in the viewer's zone, zone named so nobody mistakes it for airport time. */
export function instantLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date(ms));
}

export function clockLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(ms));
}

export function firstSegment(it: ItinerarySummary): SegmentSummary | undefined {
  return it.segments[0];
}

export function lastSegment(it: ItinerarySummary): SegmentSummary | undefined {
  return it.segments[it.segments.length - 1];
}

export function routeCodes(it: ItinerarySummary): string[] {
  const first = it.segments[0];
  if (!first) return [];
  return [first.origin, ...it.segments.map((s) => s.destination)];
}

export function routeLabel(it: ItinerarySummary): string {
  return routeCodes(it).join(" → ");
}

export function durationLabel(it: ItinerarySummary): string {
  const first = firstSegment(it);
  const last = lastSegment(it);
  if (!first || !last) return "";
  let mins: number;
  try {
    mins = Math.round((parseInstant(last.arrivingAt) - parseInstant(first.departingAt)) / 60000);
  } catch {
    return "";
  }
  if (!Number.isFinite(mins) || mins < 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function stopsLabel(it: ItinerarySummary): string {
  if (it.stops <= 0) return "Nonstop";
  const via = it.segments.slice(0, -1).map((s) => s.destination);
  const where = via.length ? ` in ${via.join(", ")}` : "";
  return `${it.stops} stop${it.stops === 1 ? "" : "s"}${where}`;
}

export function flightLabel(s: SegmentSummary): string {
  return `${s.carrierCode} ${s.flightNumber}`.trim();
}

export function flightsLabel(it: ItinerarySummary): string {
  return it.segments.map(flightLabel).join(", ");
}

const CARRIER_NAMES: Record<string, string> = {
  ZZ: "Duffel Airways",
};

export function carrierName(code: string | null | undefined): string {
  if (!code) return "";
  return CARRIER_NAMES[code] ?? code;
}

const AIRPORT_NAMES: Record<string, string> = {
  LHR: "London Heathrow",
  LTN: "London Luton",
  LGW: "London Gatwick",
  STN: "London Stansted",
  LCY: "London City",
  MAN: "Manchester",
  BHX: "Birmingham",
  EDI: "Edinburgh",
  GLA: "Glasgow",
  BRS: "Bristol",
  NCL: "Newcastle",
};

export function airportName(code: string): string {
  return AIRPORT_NAMES[code] ?? code;
}

export type Expiry = { label: string; expired: boolean };

export function relativeExpiry(expiresAt: string, now: number): Expiry {
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return { label: "unknown", expired: false };
  const left = ms - now;
  if (left <= 0) return { label: "expired", expired: true };
  const mins = Math.ceil(left / 60000);
  if (mins < 60) return { label: `${mins} min`, expired: false };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { label: m ? `${h} h ${m} min` : `${h} h`, expired: false };
}

export function money(m: Money): string {
  try {
    return formatMoney(m.amount, m.currency);
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}

/** Fare deltas read as "+£22.00" when positive so a refund is never misread. */
export function signedMoney(m: Money): string {
  try {
    const formatted = formatMoney(m.amount, m.currency);
    return isPositiveAmount(m.amount) ? `+${formatted}` : formatted;
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}
