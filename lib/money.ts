/**
 * Decimal-safe money helpers. Amounts are decimal strings; arithmetic uses
 * BigInt at a fixed scale so 0.1 + 0.2 style errors cannot occur.
 */
const SCALE = 4;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

function toScaled(value: string): bigint {
  if (!isDecimalString(value)) {
    throw new Error(`Invalid decimal amount: ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  const [whole, frac = ""] = (negative ? value.slice(1) : value).split(".");
  const fracPadded = (frac + "0".repeat(SCALE)).slice(0, SCALE);
  const scaled = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fracPadded);
  return negative ? -scaled : scaled;
}

function fromScaled(scaled: bigint, decimals = 2): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 10n ** BigInt(SCALE);
  const frac = (abs % 10n ** BigInt(SCALE)).toString().padStart(SCALE, "0").slice(0, decimals);
  const body = decimals > 0 ? `${whole}.${frac}` : `${whole}`;
  return negative && body.replace(/[0.]/g, "") !== "" ? `-${body}` : body;
}

/** Returns -1, 0, or 1 */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const x = toScaled(a);
  const y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function addAmounts(a: string, b: string): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subtractAmounts(a: string, b: string): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function isPositiveAmount(a: string): boolean {
  return toScaled(a) > 0n;
}

export function normalizeAmount(a: string): string {
  return fromScaled(toScaled(a));
}

export function formatMoney(amount: string, currency: string): string {
  const normalized = normalizeAmount(amount);
  try {
    const n = Number(normalized);
    if (Number.isFinite(n) && Math.abs(n) < 1e12) {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
    }
  } catch {
    // fall through
  }
  return `${normalized} ${currency}`;
}
