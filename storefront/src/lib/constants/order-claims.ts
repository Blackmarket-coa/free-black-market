/**
 * Order-claim constants and labels.
 *
 * Deliberately a plain module with no `"use server"` directive. These used to
 * live in `lib/data/order-claims.ts` alongside the server actions, which broke
 * `next build`: a `"use server"` module may export **only async functions**, so
 * exporting a number and a lookup table from one is a hard compile error.
 * Neither `tsc --noEmit` nor ESLint catches it — only a real build does.
 *
 * Types are exempt (erased before the check runs), which is why the type
 * definitions can stay next to the fetchers while these cannot.
 */

export type OrderClaimReason =
  | "not_received"
  | "not_as_described"
  | "damaged"
  | "missing_items"

/**
 * How long after an order a claim can be filed. Mirrors `CLAIM_WINDOW_DAYS`
 * in `backend/src/api/store/order-claims/route.ts` — the backend enforces it,
 * this copy is for stating it on the policy page before a buyer tries.
 *
 * 60, not 30, since 2026-09-03: claims are now backed by `order-dispute`,
 * whose filing window is `DEFAULT_FILING_WINDOW_DAYS` in
 * `backend/src/modules/order-dispute/resolution.ts`, and the backend's
 * `CLAIM_WINDOW_DAYS` is defined AS that value so the two systems can never
 * publish different numbers again. Change it there, then here.
 */
export const CLAIM_WINDOW_DAYS = 60

export const CLAIM_REASON_LABELS: Record<OrderClaimReason, string> = {
  not_received: "It never arrived",
  not_as_described: "It isn't what was described",
  damaged: "It arrived damaged",
  missing_items: "Part of the order is missing",
}
