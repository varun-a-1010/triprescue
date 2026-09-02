import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ChangePreview, ChangeResult, ItinerarySummary, RecoveryOption, RecoverySearchResult, StatusResult, TripState } from "@/lib/types";

vi.mock("@/lib/client/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/api")>();
  return { ...actual, callApi: vi.fn() };
});

import { ApiClientError, callApi } from "@/lib/client/api";
import * as store from "@/lib/client/store";
import { buildTools, MAX_AGENT_OPTIONS } from "@/lib/webmcp/tools";

type CallApiMock = Mock<(path: string, options?: { method?: string; body?: unknown; signal?: AbortSignal }) => Promise<{ data: unknown; requestId: string }>>;
const api = callApi as unknown as CallApiMock;

const COMPACT_LIMIT = 1500;
const DAY = "2026-10-17";

function itin(...flights: Array<[string, string, string, string, string]>): ItinerarySummary {
  return {
    segments: flights.map(([origin, destination, dep, arr, flightNumber]) => ({
      origin,
      destination,
      departingAt: `${DAY}T${dep}:00+01:00`,
      arrivingAt: `${DAY}T${arr}:00+01:00`,
      carrierCode: "ZZ",
      flightNumber,
    })),
    stops: flights.length - 1,
  };
}

const original = itin(["LHR", "LTN", "10:00", "11:05", "0101"]);
const moved = itin(["LHR", "LTN", "15:30", "16:35", "0101"]);

function option(i: number, eligible = true): RecoveryOption {
  const h = 12 + i;
  return {
    optionKey: `opt_abcdef${String(i).padStart(6, "0")}`,
    itinerary: itin(["LHR", "MAN", `${h}:00`, `${h + 1}:10`, `02${i}1`], ["MAN", "LTN", `${h + 2}:00`, `${h + 3}:05`, `02${i}2`]),
    fareDelta: { amount: `${20 + i}.00`, currency: "GBP" },
    penalty: { amount: "20.00", currency: "GBP" },
    totalCost: { amount: `${40 + i}.00`, currency: "GBP" },
    expiresAt: `${DAY}T09:30:00.000Z`,
    eligible,
    eligibilityReasons: eligible ? [] : [`arrives after ${DAY}T13:00:00+01:00`, `costs ${40 + i}.00 GBP, above the 30.00 limit`],
  };
}

const tripState: TripState = {
  trip: {
    tripId: "trp_0123456789ab",
    providerOrderId: "ord_0000FixtureOrder",
    bookingReference: "FX0001",
    carrierCode: "ZZ",
    itinerary: moved,
    status: "booked",
    changeAvailable: true,
    sandbox: true,
    providerMode: "fixture",
  },
  disruption: {
    kind: "airline_schedule_change",
    status: "action required",
    receivedAt: "2026-09-02T10:00:00.000Z",
    message: "Simulated airline schedule change: ZZ 0101 LHR→LTN moved from 10:00 to 15:30 on 2026-10-17.",
    previous: original,
  },
  preview: null,
  providerMode: "fixture",
};

/** Extra provider-ish noise that must never survive compaction. */
const noisyTrip = {
  ...tripState,
  passengers: [{ id: "pas_1", given_name: "Ada", family_name: "Lovelace", email: "ada@example.com" }],
  rawProvider: { passenger_count: 1 },
} as unknown as TripState;

const searchResult: RecoverySearchResult = {
  searchId: "srch_abcdef123456",
  currency: "GBP",
  constraints: { arriveBy: `${DAY}T18:00:00+01:00`, maxExtraAmount: "80.00", maxStops: 1 },
  options: [0, 1, 2, 3, 4].map((i) => option(i)),
  ineligible: [5, 6].map((i) => option(i, false)),
  expiresAt: `${DAY}T09:20:00.000Z`,
  sandbox: true,
};

const previewResult: ChangePreview = {
  previewId: "prv_abcdef123456",
  before: moved,
  after: option(0).itinerary,
  fareDelta: { amount: "22.00", currency: "GBP" },
  penalty: { amount: "20.00", currency: "GBP" },
  totalCost: { amount: "42.00", currency: "GBP" },
  expiresAt: `${DAY}T09:15:00.000Z`,
  sandbox: true,
};

const changeResult: ChangeResult = {
  status: "confirmed",
  before: moved,
  after: option(0).itinerary,
  totalCost: { amount: "42.00", currency: "GBP" },
  confirmedAt: "2026-09-02T10:05:00.000Z",
  verifiedAt: "2026-09-02T10:05:01.000Z",
  verified: true,
  sandbox: true,
};

const statusResult: StatusResult = {
  ...tripState,
  trip: { ...tripState.trip!, status: "changed", itinerary: option(0).itinerary },
  verification: { applied: true, verified: true, verifiedAt: "2026-09-02T10:05:01.000Z", confirmedAt: "2026-09-02T10:05:00.000Z", intended: option(0).itinerary },
};

function routeMock(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    "/api/trip": noisyTrip,
    "/api/recovery/search": searchResult,
    "/api/recovery/preview": previewResult,
    "/api/recovery/apply": changeResult,
    "/api/recovery/status": { ...statusResult, passengers: [{ given_name: "Ada" }] },
    ...overrides,
  };
  api.mockImplementation(async (path) => {
    if (!(path in table)) throw new Error(`unexpected route ${path}`);
    const data = table[path];
    if (data instanceof Error) throw data;
    return { data, requestId: "req_mock" };
  });
}

const tools = buildTools();
function tool(name: string): WebMCP.ModelContextTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

let controller: AbortController;
function run(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  return Promise.resolve(tool(name).execute(input, { signal: controller.signal }));
}

function size(result: unknown): number {
  return JSON.stringify(result).length;
}

beforeEach(() => {
  controller = new AbortController();
  store.__resetStoreForTests();
  api.mockReset();
  routeMock();
});

afterEach(() => {
  // Clears the tool's bounded approval timer if a test left one running.
  controller.abort();
});

describe("tool registry", () => {
  it("exposes the five tools with honest annotations and closed input schemas", () => {
    expect(tools.map((t) => t.name)).toEqual(["get_trip", "find_recovery_options", "preview_trip_change", "apply_trip_change", "get_change_status"]);
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.annotations?.untrustedContentHint, t.name).toBe(true);
      expect((t.inputSchema as { additionalProperties?: boolean }).additionalProperties, t.name).toBe(false);
    }
    expect(tool("get_trip").annotations?.readOnlyHint).toBe(true);
    expect(tool("get_change_status").annotations?.readOnlyHint).toBe(true);
    for (const name of ["find_recovery_options", "preview_trip_change", "apply_trip_change"]) {
      expect(tool(name).annotations?.readOnlyHint, name).toBe(false);
    }
  });
});

describe("compact results", () => {
  it("get_trip returns a compact trip with no passenger data", async () => {
    const result = (await run("get_trip")) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(size(result)).toBeLessThan(COMPACT_LIMIT);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("passenger");
    expect(JSON.stringify(result)).not.toContain("Ada");
    expect(result.trip).toMatchObject({ providerOrderId: "ord_0000FixtureOrder", status: "booked" });
    expect((result.trip as { itinerary: { flights: unknown[] } }).itinerary.flights).toHaveLength(1);
    expect(result.disruption).toMatchObject({ kind: "airline_schedule_change" });
    expect(result.stagedPreview).toBeNull();
    expect(api).toHaveBeenCalledWith("/api/trip", expect.objectContaining({ signal: controller.signal }));
  });

  it("get_trip reports no trip (ok) when the session has no sandbox order", async () => {
    routeMock({ "/api/trip": new ApiClientError("NO_DEMO_ORDER", "none", true, "req_x") });
    const result = (await run("get_trip")) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, trip: null, sandbox: true });
    expect(typeof result.note).toBe("string");
  });

  it("find_recovery_options caps at MAX_AGENT_OPTIONS and stays compact", async () => {
    expect(size(searchResult)).toBeGreaterThan(COMPACT_LIMIT); // the raw payload really is bigger
    const result = (await run("find_recovery_options", { maxStops: 1 })) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    const options = result.options as Array<Record<string, unknown>>;
    expect(options.length).toBeLessThanOrEqual(MAX_AGENT_OPTIONS);
    expect(options.length).toBe(3);
    expect(size(result)).toBeLessThan(COMPACT_LIMIT);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("passenger");
    expect(options[0]).toMatchObject({ optionKey: "opt_abcdef000000", stops: 1, totalCost: "40.00 GBP", penalty: "20.00 GBP" });
    expect(options[0].flights).toEqual(["ZZ 0201 LHR-MAN", "ZZ 0202 MAN-LTN"]);
    expect(result.searchId).toBe("srch_abcdef123456");
    expect(typeof result.nextStep).toBe("string");
    const ineligible = result.ineligible as Array<{ optionKey: string; reasons: string[] }>;
    expect(ineligible).toHaveLength(2);
    expect(ineligible[0].reasons[0]).toMatch(/^arrives after/);
    expect(api).toHaveBeenCalledWith("/api/recovery/search", expect.objectContaining({ method: "POST", body: { maxStops: 1 } }));
  });

  it("find_recovery_options explains an empty result instead of relaxing limits", async () => {
    routeMock({ "/api/recovery/search": { ...searchResult, options: [], ineligible: [option(5, false)] } });
    const result = (await run("find_recovery_options")) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.options).toEqual([]);
    expect(result.nextStep).toBeUndefined();
    expect(String(result.note)).toMatch(/do not exceed it silently/);
    expect(size(result)).toBeLessThan(COMPACT_LIMIT);
  });

  it("preview_trip_change returns a compact before/after", async () => {
    const result = (await run("preview_trip_change", { searchId: "srch_abcdef123456", optionKey: "opt_abcdef000000" })) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(size(result)).toBeLessThan(COMPACT_LIMIT);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("passenger");
    expect(result).toMatchObject({ previewId: "prv_abcdef123456", totalCost: "42.00 GBP", penalty: "20.00 GBP", fareDelta: "22.00 GBP", sandbox: true });
    expect((result.before as { flights: unknown[] }).flights).toHaveLength(1);
    expect((result.after as { flights: unknown[] }).flights).toHaveLength(2);
    expect(String(result.nextStep)).toMatch(/Nothing is booked yet/);
    expect(store.getState().preview?.previewId).toBe("prv_abcdef123456");
  });

  it("get_change_status returns compact verification with no passenger data", async () => {
    const result = (await run("get_change_status")) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(size(result)).toBeLessThan(COMPACT_LIMIT);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("passenger");
    expect(result.verification).toMatchObject({ applied: true, verified: true, confirmedAt: "2026-09-02T10:05:00.000Z" });
    expect((result.verification as { intended: { flights: unknown[] } }).intended.flights).toHaveLength(2);
    expect(result.awaitingApproval).toBe(false);
    expect((result.trip as { status: string }).status).toBe("changed");
  });
});

describe("input validation", () => {
  it.each([
    ["find_recovery_options", { maxStops: 5 }],
    ["find_recovery_options", { maxExtraAmount: "£80" }],
    ["find_recovery_options", { arriveBy: "2026-10-17T18:00:00" }],
    ["find_recovery_options", { cabin: "business" }],
    ["preview_trip_change", { searchId: "bad", optionKey: "opt_abcdef000000" }],
    ["preview_trip_change", { searchId: "srch_abcdef123456" }],
    ["apply_trip_change", { previewId: "nope" }],
    ["apply_trip_change", {}],
    ["get_trip", { extra: true }],
    ["get_change_status", { extra: true }],
  ])("%s rejects %j without calling the API", async (name, input) => {
    const result = (await run(name, input)) as { ok: boolean; error: { code: string; message: string; retrySafe: boolean } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_INPUT");
    expect(result.error.retrySafe).toBe(false);
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(api).not.toHaveBeenCalled();
  });
});

describe("error surfaces", () => {
  it("returns API errors as structured results instead of throwing", async () => {
    routeMock({ "/api/recovery/search": new ApiClientError("NO_RECOVERY_OPTIONS", "The airline returned no change offers.", true, "req_err") });
    const result = (await run("find_recovery_options")) as { ok: boolean; error: Record<string, unknown> };
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "NO_RECOVERY_OPTIONS", retrySafe: true, requestId: "req_err" });
  });
});

describe("apply_trip_change", () => {
  it("refuses when the previewId is not the one on the page and never calls the apply API", async () => {
    const result = (await run("apply_trip_change", { previewId: "prv_abcdef123456" })) as { ok: boolean; error: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("PREVIEW_EXPIRED");
    expect(api).not.toHaveBeenCalled();
    expect(store.getState().approval).toBeNull();
  });

  it("refuses a stale previewId that differs from the staged one", async () => {
    await run("preview_trip_change", { searchId: "srch_abcdef123456", optionKey: "opt_abcdef000000" });
    api.mockClear();
    const result = (await run("apply_trip_change", { previewId: "prv_stale0000001" })) as { ok: boolean; error: { code: string } };
    expect(result).toMatchObject({ ok: false, error: { code: "PREVIEW_EXPIRED" } });
    expect(api).not.toHaveBeenCalled();
  });

  it("only confirms through the page approval and then returns a compact result", async () => {
    await run("preview_trip_change", { searchId: "srch_abcdef123456", optionKey: "opt_abcdef000000" });
    api.mockClear();

    const pending = run("apply_trip_change", { previewId: "prv_abcdef123456" });
    // The dialog is open and nothing has been sent yet.
    expect(store.getState().approval?.previewId).toBe("prv_abcdef123456");
    expect(api).not.toHaveBeenCalled();

    await store.confirmApproval();
    const result = (await pending) as Record<string, unknown>;

    expect(result).toMatchObject({ ok: true, status: "confirmed", verified: true, totalCost: "42.00 GBP", sandbox: true });
    expect(size(result)).toBeLessThan(COMPACT_LIMIT);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("passenger");
    const applyCall = api.mock.calls.find(([path]) => path === "/api/recovery/apply");
    expect(applyCall).toBeDefined();
    expect(applyCall![1]?.body).toMatchObject({ previewId: "prv_abcdef123456", idempotencyKey: expect.stringMatching(/^idem_[A-Za-z0-9]{12}$/) });
    expect(store.getState().approval).toBeNull();
    expect(store.getState().result?.status).toBe("confirmed");
  });

  it("reports the traveller's cancellation without calling the apply API", async () => {
    await run("preview_trip_change", { searchId: "srch_abcdef123456", optionKey: "opt_abcdef000000" });
    api.mockClear();
    const pending = run("apply_trip_change", { previewId: "prv_abcdef123456" });
    store.cancelApproval();
    const result = (await pending) as { ok: boolean; error: { code: string } };
    expect(result).toMatchObject({ ok: false, error: { code: "APPROVAL_CANCELLED", retrySafe: true } });
    expect(api).not.toHaveBeenCalled();
    expect(store.getState().preview?.previewId).toBe("prv_abcdef123456");
  });

  it("never confirms when the agent aborts while the dialog is open", async () => {
    await run("preview_trip_change", { searchId: "srch_abcdef123456", optionKey: "opt_abcdef000000" });
    api.mockClear();
    const pending = run("apply_trip_change", { previewId: "prv_abcdef123456" });
    controller.abort();
    const result = (await pending) as { ok: boolean; error: { code: string } };
    expect(result).toMatchObject({ ok: false, error: { code: "ABORTED" } });
    expect(api).not.toHaveBeenCalled();
    expect(store.getState().approval).toBeNull();
  });
});
