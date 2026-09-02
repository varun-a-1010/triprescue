export const ERROR_CODES = [
  "NO_DEMO_ORDER",
  "ORDER_NOT_CHANGEABLE",
  "DISRUPTION_ALREADY_TRIGGERED",
  "NO_RECOVERY_OPTIONS",
  "OFFER_EXPIRED",
  "OPTION_NOT_IN_PREVIEW",
  "TRIP_CHANGED",
  "APPROVAL_CANCELLED",
  "APPROVAL_REQUIRED",
  "PREVIEW_EXPIRED",
  "ALREADY_CONFIRMED",
  "VERIFICATION_FAILED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "ABORTED",
  "INVALID_INPUT",
  "FORBIDDEN_ORIGIN",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Record<ErrorCode, number> = {
  NO_DEMO_ORDER: 409,
  ORDER_NOT_CHANGEABLE: 409,
  DISRUPTION_ALREADY_TRIGGERED: 409,
  NO_RECOVERY_OPTIONS: 404,
  OFFER_EXPIRED: 410,
  OPTION_NOT_IN_PREVIEW: 404,
  TRIP_CHANGED: 409,
  APPROVAL_CANCELLED: 409,
  APPROVAL_REQUIRED: 409,
  PREVIEW_EXPIRED: 410,
  ALREADY_CONFIRMED: 200,
  VERIFICATION_FAILED: 502,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 502,
  ABORTED: 499,
  INVALID_INPUT: 400,
  FORBIDDEN_ORIGIN: 403,
  INTERNAL: 500,
};

const RETRY_SAFE: Record<ErrorCode, boolean> = {
  NO_DEMO_ORDER: true,
  ORDER_NOT_CHANGEABLE: true,
  DISRUPTION_ALREADY_TRIGGERED: true,
  NO_RECOVERY_OPTIONS: true,
  OFFER_EXPIRED: true,
  OPTION_NOT_IN_PREVIEW: false,
  TRIP_CHANGED: true,
  APPROVAL_CANCELLED: true,
  APPROVAL_REQUIRED: true,
  PREVIEW_EXPIRED: true,
  ALREADY_CONFIRMED: true,
  VERIFICATION_FAILED: false,
  RATE_LIMITED: true,
  PROVIDER_UNAVAILABLE: true,
  ABORTED: true,
  INVALID_INPUT: false,
  FORBIDDEN_ORIGIN: false,
  INTERNAL: false,
};

export type ErrorDetails = Record<string, string | number | boolean>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retrySafe: boolean;
  readonly status: number;
  readonly details?: ErrorDetails;

  constructor(
    code: ErrorCode,
    message: string,
    options: { retrySafe?: boolean; status?: number; details?: ErrorDetails; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.retrySafe = options.retrySafe ?? RETRY_SAFE[code];
    this.status = options.status ?? HTTP_STATUS[code];
    this.details = options.details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retrySafe: this.retrySafe,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "AbortError"
  );
}
