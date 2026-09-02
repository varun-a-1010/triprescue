import { describe, expect, it } from "vitest";
import { newSession, opaqueId, openSession, sealSession, sessionHash, tripIdFor, type SessionState } from "@/lib/session";

function richSession(): SessionState {
  return {
    ...newSession(),
    orderId: "ord_0000AbCdEfGh",
    tripStatus: "booked",
    disruption: { changeId: "aic_0000XyZ", triggeredAt: "2026-09-02T10:00:00.000Z" },
    search: {
      searchId: "srch_abc123XYZ",
      createdAt: "2026-09-02T10:00:00.000Z",
      expiresAt: "2026-09-02T10:20:00.000Z",
      fingerprint: "0123456789abcdef01234567",
      prefs: { maxStops: 0 },
      currency: "GBP",
      options: { opt_abc123XYZ: { offerId: "oco_0000Offer", expiresAt: "2026-09-02T10:30:00.000Z", total: { amount: "42.00", currency: "GBP" } } },
    },
  };
}

describe("sealSession / openSession", () => {
  it("round-trips the full session state", () => {
    const state = richSession();
    const sealed = sealSession(state);
    expect(openSession(sealed)).toEqual(state);
  });

  it("produces a different blob each time (fresh IV) that still opens to the same state", () => {
    const state = richSession();
    const a = sealSession(state);
    const b = sealSession(state);
    expect(a).not.toBe(b);
    expect(openSession(a)).toEqual(openSession(b));
  });

  it("returns null when a single character is tampered with", () => {
    const sealed = sealSession(richSession());
    let flipped = 0;
    // Try several positions across IV, tag and ciphertext; every one must fail auth.
    for (const pos of [0, 5, 15, 20, 30, sealed.length - 1]) {
      const original = sealed[pos];
      const replacement = original === "A" ? "B" : "A";
      const tampered = sealed.slice(0, pos) + replacement + sealed.slice(pos + 1);
      expect(tampered).not.toBe(sealed);
      // base64url can encode the same bytes with a different final character
      // (unused trailing bits); a byte-identical "tamper" is not a tamper.
      if (Buffer.from(tampered, "base64url").equals(Buffer.from(sealed, "base64url"))) continue;
      expect(openSession(tampered), `position ${pos}`).toBeNull();
      flipped += 1;
    }
    expect(flipped).toBe(6);
  });

  it("returns null for empty, missing, truncated or non-base64 input", () => {
    expect(openSession(undefined)).toBeNull();
    expect(openSession(null)).toBeNull();
    expect(openSession("")).toBeNull();
    expect(openSession("short")).toBeNull();
    expect(openSession(sealSession(richSession()).slice(0, 40))).toBeNull();
    expect(openSession("!!!not base64url!!!")).toBeNull();
  });

  it("does not contain any plaintext substring of the session (opaque ids included)", () => {
    const state = richSession();
    const sealed = sealSession(state);
    for (const s of [state.orderId!, "ord_", state.search!.searchId, "oco_", state.disruption!.changeId, state.sid, '"v":1']) {
      expect(sealed, s).not.toContain(s);
    }
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a validly sealed payload that is not a v1 session", () => {
    const bogus = sealSession({ v: 2, sid: "x" } as unknown as SessionState);
    expect(openSession(bogus)).toBeNull();
    const noSid = sealSession({ v: 1 } as unknown as SessionState);
    expect(openSession(noSid)).toBeNull();
  });
});

describe("ids", () => {
  it("newSession has a v1 marker and a random sid", () => {
    const a = newSession();
    const b = newSession();
    expect(a.v).toBe(1);
    expect(a.sid).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a.sid).not.toBe(b.sid);
    expect(Object.keys(a).sort()).toEqual(["sid", "v"]);
  });

  it("opaqueId matches the validation regex for each prefix", () => {
    expect(opaqueId("srch")).toMatch(/^srch_[A-Za-z0-9]{6,32}$/);
    expect(opaqueId("opt")).toMatch(/^opt_[A-Za-z0-9]{6,32}$/);
    expect(opaqueId("prv")).toMatch(/^prv_[A-Za-z0-9]{6,32}$/);
    const many = new Set(Array.from({ length: 50 }, () => opaqueId("srch")));
    expect(many.size).toBe(50);
  });

  it("tripIdFor is deterministic, prefixed, and does not embed the order id", () => {
    const id = tripIdFor("ord_0000AbCdEfGh");
    expect(id).toMatch(/^trp_[0-9a-f]{12}$/);
    expect(id).toBe(tripIdFor("ord_0000AbCdEfGh"));
    expect(id).not.toBe(tripIdFor("ord_0000Different"));
    expect(id).not.toContain("ord_");
  });

  it("sessionHash is a short stable hex digest that is not the sid", () => {
    const s = newSession();
    const h = sessionHash(s);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(h).toBe(sessionHash(s));
    expect(h).not.toContain(s.sid);
  });
});
