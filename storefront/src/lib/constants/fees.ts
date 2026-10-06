/**
 * Fee constants.
 *
 * A plain module with no `"use server"` directive, for the same reason as
 * `lib/constants/order-claims.ts`: a `"use server"` module may export only
 * async functions, so keeping this next to `getFeeSchedule` in
 * `lib/data/fee-schedule.ts` broke `next build`.
 */

/**
 * The rate quoted if `/store/fee-schedule` is unreachable.
 *
 * Must equal `PLATFORM_DEFAULT_FEE_PERCENT` in
 * `backend/src/modules/vendor-plan/catalog.ts` — the rate a seller pays with no
 * plan and no negotiated override. `src/lib/__tests__/fee-schedule.spec.ts`
 * reads that constant out of the backend source and fails if the two drift.
 *
 * A fallback is the right call rather than hiding the number: the flat fee is
 * the platform's central promise, and a page that renders "we take —%" during a
 * backend blip is worse than one that renders the rate we have charged since
 * launch. But an unchecked duplicate of a number we are accountable for is
 * exactly the drift this work exists to prevent, hence the test.
 */
export const FALLBACK_DEFAULT_FEE_PERCENT = 3

/**
 * The card-processing estimate quoted when `/store/fee-schedule` says the
 * model is fee-first but could not send its figures (backend unreachable, or
 * its config unreadable). Must equal the backend's default payout config
 * (`payment_processing_percent` / `payment_processing_fixed` in
 * `backend/src/modules/payout-breakdown/service.ts` `getDefaultConfig`);
 * `src/lib/__tests__/fee-schedule.spec.ts` fails if they drift. Only ever
 * shown labelled as an estimate.
 */
export const FALLBACK_PROCESSING_PERCENT = 2.9
export const FALLBACK_PROCESSING_FIXED_CENTS = 30
