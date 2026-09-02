import { describe, expect, it } from "vitest";
import {
  addAmounts,
  compareAmounts,
  formatMoney,
  isDecimalString,
  isPositiveAmount,
  normalizeAmount,
  subtractAmounts,
} from "@/lib/money";

describe("compareAmounts", () => {
  it("treats equal decimals as equal regardless of formatting", () => {
    expect(compareAmounts("80.00", "80.00")).toBe(0);
    expect(compareAmounts("80", "80.00")).toBe(0);
    expect(compareAmounts("80.0", "80.00")).toBe(0);
  });

  it("orders exactly at the penny boundary", () => {
    expect(compareAmounts("80.01", "80.00")).toBe(1);
    expect(compareAmounts("80.00", "80.01")).toBe(-1);
    expect(compareAmounts("79.99", "80.00")).toBe(-1);
  });

  it("does not suffer from binary float error", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754; the decimal helpers must not care.
    expect(compareAmounts(addAmounts("0.1", "0.2"), "0.3")).toBe(0);
  });

  it("handles negative amounts", () => {
    expect(compareAmounts("-0.01", "0.00")).toBe(-1);
    expect(compareAmounts("-5.00", "-10.00")).toBe(1);
  });
});

describe("addAmounts", () => {
  it("0.1 + 0.2 is exactly 0.30", () => {
    expect(addAmounts("0.1", "0.2")).toBe("0.30");
  });

  it("carries across the decimal point", () => {
    expect(addAmounts("0.99", "0.01")).toBe("1.00");
    expect(addAmounts("42.00", "20.00")).toBe("62.00");
  });
});

describe("subtractAmounts", () => {
  it("subtracts to two decimals", () => {
    expect(subtractAmounts("42.00", "20.00")).toBe("22.00");
    expect(subtractAmounts("5.00", "5.00")).toBe("0.00");
  });

  it("produces a negative result when the subtrahend is larger", () => {
    expect(subtractAmounts("10.00", "12.50")).toBe("-2.50");
    expect(subtractAmounts("12.00", "20.00")).toBe("-8.00");
  });
});

describe("isPositiveAmount", () => {
  it("is false for zero and negatives, true for any positive penny", () => {
    expect(isPositiveAmount("0.00")).toBe(false);
    expect(isPositiveAmount("0")).toBe(false);
    expect(isPositiveAmount("-1.00")).toBe(false);
    expect(isPositiveAmount("0.01")).toBe(true);
  });
});

describe("normalizeAmount", () => {
  it("pads to two decimals", () => {
    expect(normalizeAmount("42")).toBe("42.00");
    expect(normalizeAmount("42.5")).toBe("42.50");
    expect(normalizeAmount("0")).toBe("0.00");
  });

  it("never emits a negative zero", () => {
    expect(normalizeAmount("-0.00")).toBe("0.00");
    expect(subtractAmounts("1.00", "1.00")).toBe("0.00");
  });
});

describe("invalid amounts", () => {
  it.each(["£80", "80.", ".5", "abc", "", "1e3", "80,00", " 80"])("rejects %j", (bad) => {
    expect(isDecimalString(bad)).toBe(false);
    expect(() => normalizeAmount(bad)).toThrow(/Invalid decimal amount/);
    expect(() => compareAmounts(bad, "1.00")).toThrow(/Invalid decimal amount/);
    expect(() => addAmounts("1.00", bad)).toThrow(/Invalid decimal amount/);
  });
});

describe("formatMoney", () => {
  it("formats with the currency symbol for display", () => {
    expect(formatMoney("42", "GBP")).toBe("£42.00");
    expect(formatMoney("1250.5", "EUR")).toBe("€1,250.50");
  });
});
