import { describe, expect, it } from "vitest";
import {
  addMinutesIso,
  compareInstants,
  futureDate,
  hasOffset,
  isBefore,
  localDateOf,
  localToIso,
  minInstant,
  parseInstant,
} from "@/lib/time";

describe("localToIso", () => {
  it("attaches the BST offset for a London summer date", () => {
    expect(localToIso("2026-10-17T10:00:00", "Europe/London")).toBe("2026-10-17T10:00:00+01:00");
  });

  it("attaches the GMT offset for a London winter date", () => {
    expect(localToIso("2026-12-17T10:00:00", "Europe/London")).toBe("2026-12-17T10:00:00+00:00");
  });

  it("accepts a minute-precision local time", () => {
    expect(localToIso("2026-10-17T10:00", "Europe/London")).toBe("2026-10-17T10:00:00+01:00");
  });

  it("handles negative and half-hour offsets", () => {
    expect(localToIso("2026-10-17T10:00:00", "America/New_York")).toBe("2026-10-17T10:00:00-04:00");
    expect(localToIso("2026-10-17T10:00:00", "Asia/Kolkata")).toBe("2026-10-17T10:00:00+05:30");
  });

  it("returns inputs that already carry an offset unchanged", () => {
    expect(localToIso("2026-10-17T10:00:00Z", "Europe/London")).toBe("2026-10-17T10:00:00Z");
    expect(localToIso("2026-10-17T10:00:00+02:00", "Europe/London")).toBe("2026-10-17T10:00:00+02:00");
    expect(localToIso("2026-10-17T10:00:00.250-05:00", "Europe/London")).toBe("2026-10-17T10:00:00.250-05:00");
  });

  it("rejects unrecognised local formats", () => {
    expect(() => localToIso("2026-10-17 10:00:00", "Europe/London")).toThrow(/Unrecognized local datetime/);
    expect(() => localToIso("17/10/2026", "Europe/London")).toThrow(/Unrecognized local datetime/);
  });
});

describe("hasOffset", () => {
  it.each(["2026-10-17T10:00:00Z", "2026-10-17T10:00:00+01:00", "2026-10-17T10:00+01:00", "2026-10-17T10:00:00.123-05:00"])(
    "is true for %s",
    (iso) => expect(hasOffset(iso)).toBe(true),
  );

  it.each(["2026-10-17T10:00:00", "2026-10-17", "2026-10-17T10:00:00+0100", "not a date"])("is false for %s", (s) =>
    expect(hasOffset(s)).toBe(false),
  );
});

describe("compareInstants", () => {
  it("compares absolute instants, not local wall-clock strings", () => {
    // 18:00 at +01:00 is 17:00Z, which is EARLIER than 17:30Z even though the
    // string "18:00" sorts after "17:30".
    expect(compareInstants("2026-10-17T18:00:00+01:00", "2026-10-17T17:30:00Z")).toBe(-1);
    expect(compareInstants("2026-10-17T17:30:00Z", "2026-10-17T18:00:00+01:00")).toBe(1);
  });

  it("treats the same instant in different offsets as equal", () => {
    expect(compareInstants("2026-10-17T18:00:00+01:00", "2026-10-17T17:00:00Z")).toBe(0);
    expect(compareInstants("2026-10-17T12:00:00-05:00", "2026-10-17T17:00:00+00:00")).toBe(0);
  });

  it("backs isBefore", () => {
    expect(isBefore("2026-10-17T18:00:00+01:00", "2026-10-17T17:30:00Z")).toBe(true);
    expect(isBefore("2026-10-17T17:30:00Z", "2026-10-17T18:00:00+01:00")).toBe(false);
    expect(isBefore("2026-10-17T17:00:00Z", "2026-10-17T18:00:00+01:00")).toBe(false);
  });

  it("throws on unparseable instants", () => {
    expect(() => parseInstant("garbage")).toThrow(/Invalid instant/);
    expect(() => compareInstants("garbage", "2026-10-17T17:30:00Z")).toThrow(/Invalid instant/);
  });
});

describe("minInstant", () => {
  it("returns the earlier instant across offsets, preserving the original string", () => {
    expect(minInstant("2026-10-17T18:00:00+01:00", "2026-10-17T17:30:00Z")).toBe("2026-10-17T18:00:00+01:00");
    expect(minInstant("2026-10-17T17:30:00Z", "2026-10-17T18:00:00+01:00")).toBe("2026-10-17T18:00:00+01:00");
  });

  it("returns the first argument on a tie", () => {
    expect(minInstant("2026-10-17T18:00:00+01:00", "2026-10-17T17:00:00Z")).toBe("2026-10-17T18:00:00+01:00");
  });
});

describe("addMinutesIso / localDateOf", () => {
  it("adds minutes on the absolute timeline and returns UTC", () => {
    expect(addMinutesIso("2026-10-17T10:00:00+01:00", 30)).toBe("2026-10-17T09:30:00.000Z");
  });

  it("slices the local date from an offset string", () => {
    expect(localDateOf("2026-10-17T00:30:00+01:00")).toBe("2026-10-17");
  });
});

describe("futureDate", () => {
  it("is YYYY-MM-DD exactly N days ahead of the given instant", () => {
    expect(futureDate(45, new Date("2026-01-01T00:00:00Z"))).toBe("2026-02-15");
    expect(futureDate(0, new Date("2026-01-01T12:00:00Z"))).toBe("2026-01-01");
  });

  it("defaults to 45 days ahead of now", () => {
    const value = futureDate(45);
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const expected = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    expect(value).toBe(expected);
  });
});
