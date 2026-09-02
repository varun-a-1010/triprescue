import { describe, expect, it } from "vitest";
import {
  applyInputSchema,
  applyToolInputSchema,
  emptyInputSchema,
  previewInputSchema,
  recoveryPreferencesSchema,
  seedInputSchema,
  TOOL_INPUT_SCHEMAS,
} from "@/lib/validation";

describe("recoveryPreferencesSchema", () => {
  it("accepts a fully specified, valid preference set", () => {
    const parsed = recoveryPreferencesSchema.safeParse({
      arriveBy: "2026-10-17T18:00:00+01:00",
      maxExtraAmount: "80.00",
      maxStops: 1,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ arriveBy: "2026-10-17T18:00:00+01:00", maxExtraAmount: "80.00", maxStops: 1 });
  });

  it("accepts an empty object (all preferences optional)", () => {
    expect(recoveryPreferencesSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    const parsed = recoveryPreferencesSchema.safeParse({ maxStops: 1, cabin: "business" });
    expect(parsed.success).toBe(false);
  });

  it("rejects arriveBy without a UTC offset", () => {
    const parsed = recoveryPreferencesSchema.safeParse({ arriveBy: "2026-10-17T18:00:00" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].message).toMatch(/UTC offset/);
  });

  it("accepts arriveBy with Z or a numeric offset", () => {
    expect(recoveryPreferencesSchema.safeParse({ arriveBy: "2026-10-17T18:00:00Z" }).success).toBe(true);
    expect(recoveryPreferencesSchema.safeParse({ arriveBy: "2026-10-17T18:00:00-05:00" }).success).toBe(true);
  });

  it.each(["80.123", "£80", "80,00", "-5.00", "eighty", ""])("rejects maxExtraAmount %j", (bad) => {
    const parsed = recoveryPreferencesSchema.safeParse({ maxExtraAmount: bad });
    expect(parsed.success).toBe(false);
  });

  it.each(["80", "80.5", "80.00", "0.00"])("accepts maxExtraAmount %j", (good) => {
    expect(recoveryPreferencesSchema.safeParse({ maxExtraAmount: good }).success).toBe(true);
  });

  it("rejects maxStops outside 0..2 or non-integers", () => {
    expect(recoveryPreferencesSchema.safeParse({ maxStops: 3 }).success).toBe(false);
    expect(recoveryPreferencesSchema.safeParse({ maxStops: -1 }).success).toBe(false);
    expect(recoveryPreferencesSchema.safeParse({ maxStops: 1.5 }).success).toBe(false);
    expect(recoveryPreferencesSchema.safeParse({ maxStops: "1" }).success).toBe(false);
  });
});

describe("previewInputSchema", () => {
  it("accepts well-formed opaque ids", () => {
    expect(previewInputSchema.safeParse({ searchId: "srch_abc123XYZ", optionKey: "opt_abc123XYZ" }).success).toBe(true);
  });

  it.each([
    ["missing prefix", { searchId: "abc123XYZ", optionKey: "opt_abc123XYZ" }],
    ["wrong prefix on optionKey", { searchId: "srch_abc123XYZ", optionKey: "srch_abc123XYZ" }],
    ["too short", { searchId: "srch_abc", optionKey: "opt_abc123XYZ" }],
    ["provider id smuggled in", { searchId: "srch_abc123XYZ", optionKey: "oco_0000AbCdEf" }],
    ["unsafe characters", { searchId: "srch_abc123XYZ", optionKey: "opt_abc-123" }],
    ["missing optionKey", { searchId: "srch_abc123XYZ" }],
    ["extra key", { searchId: "srch_abc123XYZ", optionKey: "opt_abc123XYZ", offerId: "oco_x" }],
  ])("rejects %s", (_label, input) => {
    expect(previewInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("applyInputSchema", () => {
  it("accepts a preview id with an idempotency key", () => {
    expect(applyInputSchema.safeParse({ previewId: "prv_abc123XYZ", idempotencyKey: "idem_abc123XYZ" }).success).toBe(true);
  });

  it.each([
    ["malformed previewId", { previewId: "preview-1", idempotencyKey: "idem_abc123XYZ" }],
    ["short idempotency key", { previewId: "prv_abc123XYZ", idempotencyKey: "abc" }],
    ["idempotency key with spaces", { previewId: "prv_abc123XYZ", idempotencyKey: "has a space!" }],
    ["missing idempotency key", { previewId: "prv_abc123XYZ" }],
    ["over-long idempotency key", { previewId: "prv_abc123XYZ", idempotencyKey: "a".repeat(65) }],
  ])("rejects %s", (_label, input) => {
    expect(applyInputSchema.safeParse(input).success).toBe(false);
  });

  it("tool-facing apply input takes only the previewId", () => {
    expect(applyToolInputSchema.safeParse({ previewId: "prv_abc123XYZ" }).success).toBe(true);
    expect(applyToolInputSchema.safeParse({ previewId: "prv_abc123XYZ", idempotencyKey: "idem_abc123XYZ" }).success).toBe(false);
  });
});

describe("seed / empty schemas", () => {
  it("seed accepts forceNew only", () => {
    expect(seedInputSchema.safeParse({}).success).toBe(true);
    expect(seedInputSchema.safeParse({ forceNew: true }).success).toBe(true);
    expect(seedInputSchema.safeParse({ forceNew: "yes" }).success).toBe(false);
    expect(seedInputSchema.safeParse({ orderId: "ord_x" }).success).toBe(false);
  });

  it("empty schema rejects any key", () => {
    expect(emptyInputSchema.safeParse({}).success).toBe(true);
    expect(emptyInputSchema.safeParse({ anything: 1 }).success).toBe(false);
  });
});

describe("TOOL_INPUT_SCHEMAS", () => {
  type LooseSchema = {
    type: string;
    additionalProperties: boolean;
    required?: readonly string[];
    properties: Record<string, { type: string; description?: string }>;
  };
  const schemas = Object.entries(TOOL_INPUT_SCHEMAS) as Array<[string, LooseSchema]>;

  it("every schema is a closed object", () => {
    for (const [name, schema] of schemas) {
      expect(schema.type, name).toBe("object");
      expect(schema.additionalProperties, name).toBe(false);
    }
  });

  it("every parameter has a description of at most 150 characters", () => {
    let checked = 0;
    for (const [name, schema] of schemas) {
      for (const [prop, def] of Object.entries(schema.properties)) {
        checked += 1;
        expect(def.description, `${name}.${prop}`).toBeTruthy();
        expect(def.description!.length, `${name}.${prop}`).toBeLessThanOrEqual(150);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("required lists only name declared properties", () => {
    for (const [name, schema] of schemas) {
      for (const req of schema.required ?? []) {
        expect(Object.keys(schema.properties), `${name}.required`).toContain(req);
      }
    }
  });

  it("mirrors the zod schemas the routes use", () => {
    expect(Object.keys(TOOL_INPUT_SCHEMAS.findRecoveryOptions.properties).sort()).toEqual(Object.keys(recoveryPreferencesSchema.shape).sort());
    expect(Object.keys(TOOL_INPUT_SCHEMAS.previewTripChange.properties).sort()).toEqual(Object.keys(previewInputSchema.shape).sort());
    expect(Object.keys(TOOL_INPUT_SCHEMAS.applyTripChange.properties).sort()).toEqual(Object.keys(applyToolInputSchema.shape).sort());
    expect(Object.keys(TOOL_INPUT_SCHEMAS.empty.properties)).toEqual([]);
  });
});
