import { beforeEach, describe, expect, it } from "vitest";
import { FixtureProvider, fixtureTestHooks } from "@/lib/providers/fixture";
import type { ChangeSearchParams, ProviderChangeOffer } from "@/lib/providers/types";
import { newSession } from "@/lib/session";
import { disrupt, search, seed, type ServiceCtx } from "@/lib/recovery/service";
import { AppError } from "@/lib/errors";

/** Fixture provider whose change offers include duplicates and the current flight. */
class NoisyProvider extends FixtureProvider {
  onlyCurrent = false;
  async searchChangeOffers(params: ChangeSearchParams) {
    const base = await super.searchChangeOffers(params);
    const order = await this.getOrder(params.orderId);
    const current = order.slices[0].itinerary;
    const sameAsCurrent: ProviderChangeOffer = { ...base.offers[0], id: "oco_same", add: structuredClone(current) };
    if (this.onlyCurrent) return { requestId: base.requestId, offers: [sameAsCurrent, { ...sameAsCurrent, id: "oco_same2" }] };
    const dup = { ...base.offers[0], id: "oco_dup" };
    return { requestId: base.requestId, offers: [sameAsCurrent, dup, ...base.offers, { ...base.offers[1], id: "oco_dup2" }] };
  }
}

function ctx(provider: NoisyProvider): ServiceCtx {
  return { provider, session: newSession(), requestId: "req_test" };
}

describe("search de-duplication", () => {
  beforeEach(() => fixtureTestHooks.reset());

  it("drops offers identical to the current itinerary and duplicate itinerary+price offers", async () => {
    const provider = new NoisyProvider();
    const c = ctx(provider);
    await seed(c, {});
    await disrupt(c);
    const result = await search(c, {});
    const all = [...result.options, ...result.ineligible];
    const keys = all.map((o) => o.itinerary.segments.map((s) => `${s.flightNumber}@${s.departingAt}`).join("|"));
    expect(new Set(keys).size).toBe(keys.length);
    const current = (await provider.getOrder(c.session.orderId!)).slices[0].itinerary;
    const currentKey = current.segments.map((s) => `${s.flightNumber}@${s.departingAt}`).join("|");
    expect(keys).not.toContain(currentKey);
    // The fixture has 4 distinct candidates; the noise added 3 more that must vanish.
    expect(all).toHaveLength(4);
  });

  it("reports NO_RECOVERY_OPTIONS when the airline only offers the current flight", async () => {
    const provider = new NoisyProvider();
    provider.onlyCurrent = true;
    const c = ctx(provider);
    await seed(c, {});
    await disrupt(c);
    await expect(search(c, {})).rejects.toMatchObject({ code: "NO_RECOVERY_OPTIONS" } satisfies Partial<AppError>);
  });
});
