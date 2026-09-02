# Duffel kill-shot spike — results (sanitized)

Run on 2026-09-02 with `npm run spike -- --runs=2` against Duffel **test mode**
(token `duffel_test_…`, never committed). Two independently seeded orders.
Only provider resource ids, times and amounts are recorded here; no passenger data.

| Step | Run 1 | Run 2 |
|---|---|---|
| Order created (LHR→LTN, Duffel Airways ZZ) | `ord_0000BA0POWuMU6bxM8zg13`, ref `WFGWGJ`, actions `cancel,change,update`, 3.7 s | `ord_0000BA0PPNRp8wH8Iz38Oc`, ref `U4C2HK`, actions `cancel,change,update`, 3.6 s |
| Original slice | `sli_…LVUsDBZzqHAET` ZZ1659 2026-10-18 13:09→13:47 +01:00 | `sli_…CVfoHooNjlYMj` ZZ1659 2026-10-19 13:56→14:34 +01:00 |
| Simulated airline change (one `GET airline_initiated_changes`) | `aic_0000BA0POgOTDX2im89LhA`, flight moved +1 h to 14:09→14:47, 0.8 s | `aic_0000BA0PPX8L8EdELS0iPo`, moved +1 h to 14:56→15:34, 0.8 s |
| Refetched order | **slice id changed** to `sli_…OgBM0IYE7S0sGB`; `airline_initiated_changes` = 1; still `change`-able | slice id changed to `sli_…WuVxdZZeZXfrf` |
| Change request (remove current slice, add same route/date, economy) | `ocr_0000BA0POpQvblMAoMMwI8`, **11 offers**, 0.8 s | `ocr_0000BA0PPfxKKYAbhtvXzk`, 11 offers, 0.8 s |
| Offer shape | all `125.00 USD` change total, `25.00 USD` penalty, expire in ~3 days; several offers share an identical itinerary (hence the dedupe in `search()`) | same |
| Pending order change | `oce_0000BA0POu9k35a1SVMmgK`, `confirmed_at: null`, 0.8 s | `oce_0000BA0PPkoeGFCOmQuBfQ` |
| Confirm with `balance` payment `125.00 USD` | `confirmed_at 2026-09-02T17:38:42Z`, 0.8 s | `confirmed_at 2026-09-02T17:38:51Z` |
| Final refetch | slice `sli_…OpRHaRdkpSXDpe` **ZZ8663 06:00→06:38** = chosen replacement → **PASS** | slice `sli_…PfxKKYAbhtvXzt` **ZZ8027 06:00→06:38** → **PASS** |
| Second confirm (idempotency probe) | 422 `order_change_already_confirmed` → mapped to `ALREADY_CONFIRMED` | same |

**Verdict: GO (2/2).** Findings folded back into the app:

- The account's billing currency is **USD**, so constraints and prices are in USD (the trip summary now carries `currency`).
- Duffel's simulated change **replaces the slice id**; the service refetches before searching and uses the current slice (covered by tests).
- Duplicate offers are deduplicated by itinerary + price before ranking.
- First attempt failed with `invalid_phone_number` for the fictional `+44 7700 900…` (UK drama range); the fictional passenger now uses `+44 7911 123456`.
