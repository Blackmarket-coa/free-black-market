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
