import { z } from "zod";
import { ISO_WITH_OFFSET_RE } from "./time";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const SEARCH_ID_RE = /^srch_[A-Za-z0-9]{6,32}$/;
const OPTION_KEY_RE = /^opt_[A-Za-z0-9]{6,32}$/;
const PREVIEW_ID_RE = /^prv_[A-Za-z0-9]{6,32}$/;

export const recoveryPreferencesSchema = z.strictObject({
  arriveBy: z.string().regex(ISO_WITH_OFFSET_RE, "arriveBy must be ISO 8601 with a UTC offset").optional(),
  maxExtraAmount: z.string().regex(AMOUNT_RE, "maxExtraAmount must be a decimal string like 80.00").optional(),
  maxStops: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
});

export const seedInputSchema = z.strictObject({
  forceNew: z.boolean().optional(),
});

export const emptyInputSchema = z.strictObject({});

export const previewInputSchema = z.strictObject({
  searchId: z.string().regex(SEARCH_ID_RE, "searchId is not a valid search id"),
  optionKey: z.string().regex(OPTION_KEY_RE, "optionKey is not a valid option key"),
});

export const applyInputSchema = z.strictObject({
  previewId: z.string().regex(PREVIEW_ID_RE, "previewId is not a valid preview id"),
  idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

/** Tool-facing apply input: the site generates the idempotency key itself */
export const applyToolInputSchema = z.strictObject({
  previewId: z.string().regex(PREVIEW_ID_RE, "previewId is not a valid preview id"),
});

export type SeedInput = z.infer<typeof seedInputSchema>;
export type PreviewInput = z.infer<typeof previewInputSchema>;
export type ApplyInput = z.infer<typeof applyInputSchema>;
export type ApplyToolInput = z.infer<typeof applyToolInputSchema>;

/**
 * JSON Schema equivalents for WebMCP tool registration. Hand-written so the
 * client bundle does not need a zod→JSON-schema converter, and so descriptions
 * stay under Chrome's recommended 150 characters.
 */
export const TOOL_INPUT_SCHEMAS = {
  empty: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  findRecoveryOptions: {
    type: "object",
    properties: {
      arriveBy: {
        type: "string",
        description: "Latest acceptable arrival, ISO 8601 with UTC offset, e.g. 2026-10-17T18:00:00+01:00.",
      },
      maxExtraAmount: {
        type: "string",
        description: "Maximum additional cost in the trip currency as a decimal string, e.g. \"80.00\".",
      },
      maxStops: {
        type: "integer",
        minimum: 0,
        maximum: 2,
        description: "Maximum number of stops, 0 through 2.",
      },
    },
    additionalProperties: false,
  },
  previewTripChange: {
    type: "object",
    properties: {
      searchId: { type: "string", description: "searchId returned by find_recovery_options." },
      optionKey: { type: "string", description: "optionKey of one option from that same search." },
    },
    required: ["searchId", "optionKey"],
    additionalProperties: false,
  },
  applyTripChange: {
    type: "object",
    properties: {
      previewId: { type: "string", description: "previewId returned by preview_trip_change." },
    },
    required: ["previewId"],
    additionalProperties: false,
  },
} as const;
