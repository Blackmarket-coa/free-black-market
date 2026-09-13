/**
 * `queued → paid`: the disbursement half of the patronage refund.
 *
 * `patronage-review.ts` deliberately stopped at `queued` — "the operator has
 * signed off on these numbers" — and said the rest "belongs to a disbursement
 * rail that does not exist yet and whose shape is a Posture A question". This
 * is that rail, and the Posture A answer it encodes is narrow enough to state
 * in one line:
 *
 * **A patronage refund is a vendor payout, so it terminates at Stripe ACH to a
 * US bank account. Always.**
 *
 * ## Why `dual-rail-selector` must not be used here
 *
 * The selector picks between `stripe_ach` and `stellar_usdc` and *prefers
 * Stellar* when the bridge is healthy. That is correct for the settlements it
 * was written for and wrong for this one. `docs/POSTURE_A_COMPLIANCE.md` is
 * explicit under "Vendor payouts": **"No USDC payouts to vendors. Vendor payout
 * always terminates at Stripe ACH to a US bank account."** Routing a patronage
 * refund through the selector would send a vendor payout over Stellar the
 * moment the bridge came up healthy — a Posture A violation arriving by
 * default, with no code change and nothing in a diff to review. So the rail is
 * fixed here rather than chosen, and this paragraph exists so the next person
 * to see two rails and one payout does not wire them together.
 *
 * ## What is refused, and why refusing is the safe direction
 *
 * `planDisbursement` is pure, and every allocation it cannot pay is returned
 * with a reason rather than skipped:
 *
 *   - no payout account on file — nowhere to send it;
 *   - a `hawala` or `manual` provider — neither is Stripe ACH, and Posture A
 *     names Stripe ACH as the only outbound rail. A `manual` account is a note
 *     that someone will handle it by hand, not an instruction to this code;
 *   - an account that is not `active` — `pending` means onboarding is
 *     unfinished, `restricted` and `suspended` mean the processor has said no;
 *   - a non-positive amount, or a currency the account cannot receive.
 *
 * A refusal leaves the row `queued`, which is the recoverable state: the
 * operator fixes the account and re-runs. Marking it `failed` would need a
 * second decision to undo. `failed` is reserved for a disbursement that was
 * actually attempted and the processor rejected.
 *
 * ## Idempotency
 *
 * Every payable allocation carries a deterministic `idempotency_key` derived
 * from its own id and period. A retry after a partial failure — the case the
 * approve endpoint was already built for — must not pay anyone twice, and the
 * key is what makes that true at the processor rather than only in our own
 * status column. A status write that lands after the transfer succeeded but
 * before the row was updated is exactly the crash this survives.
 */

import type { PatronageAllocationRow } from "./patronage-review"

/** The only provider a patronage refund may terminate at. See the note above. */
export const PATRONAGE_PAYOUT_PROVIDER = "stripe_connect"

/** The only account status a payout may be sent to. */
export const PATRONAGE_PAYABLE_ACCOUNT_STATUS = "active"

/**
 * Env flag gating actual money movement.
 *
 * Named as an assertion about the world rather than a feature switch, the same
 * way `FBM_SECURITIES_GATE_CLEARED` is: it says the operator has a live
 * processor configuration and has decided to pay this period, not that a
 * feature is available. Off, `/admin/hawala/patronage/disburse` still plans and
 * reports — which is the useful half during setup — and moves nothing.
 */
export const PATRONAGE_DISBURSEMENT_FLAG = "FBM_PATRONAGE_DISBURSEMENT_LIVE"

export type PayoutAccountRow = {
  seller_id: string
  provider?: string | null
  external_account_id?: string | null
  status?: string | null
}

export type PayableAllocation = {
  allocation_id: string
  seller_id: string
  amount: number
  currency: string
  destination_account_id: string
  /** Deterministic, so a retry cannot double-pay. */
  idempotency_key: string
}

export type UnpayableAllocation = {
  allocation_id: string
  seller_id: string
  reason: string
}

export type DisbursementPlan = {
  period_key: string
  payable: PayableAllocation[]
  unpayable: UnpayableAllocation[]
  total_payable: number
  currency: string | null
}

/**
 * The port the route executes a plan through.
 *
 * An interface rather than a direct Stripe call so the decision logic above is
 * testable without a processor, and so the adapter is a named, reviewable
 * seam rather than an inline API call in a route handler.
 */
export type PatronageDisbursementPort = {
  /**
   * Send one payout. Must be idempotent on `idempotency_key` — the caller
   * relies on it, and retries are expected rather than exceptional.
   *
   * Returns the processor's reference on success. Throwing means the
   * disbursement was rejected, and the allocation is marked `failed`.
   */
  send(payable: PayableAllocation): Promise<{ reference: string }>
}

export function isDisbursementLive(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env[PATRONAGE_DISBURSEMENT_FLAG] === "true"
}

/**
 * Decide, per allocation, whether it can be paid and where to.
 *
 * Pure: no container, no I/O, no clock. Accounts are passed in already read.
 */
export function planDisbursement(
  periodKey: string,
  rows: PatronageAllocationRow[],
  accountsBySeller: Map<string, PayoutAccountRow>
): DisbursementPlan {
  const payable: PayableAllocation[] = []
  const unpayable: UnpayableAllocation[] = []

  for (const row of rows) {
    if (row.status !== "queued") {
      continue
    }

    const base = { allocation_id: row.id, seller_id: row.seller_id }
    const account = accountsBySeller.get(row.seller_id)

    if (!account) {
      unpayable.push({
        ...base,
        reason: "No payout account on file for this seller.",
      })
      continue
    }

    if (account.provider !== PATRONAGE_PAYOUT_PROVIDER) {
      unpayable.push({
        ...base,
        reason:
          `Payout provider is "${account.provider ?? "none"}". A patronage ` +
          `refund is a vendor payout and terminates at Stripe ACH only ` +
          `(Posture A). Connect a Stripe account for this seller.`,
      })
      continue
    }

    if (account.status !== PATRONAGE_PAYABLE_ACCOUNT_STATUS) {
      unpayable.push({
        ...base,
        reason:
          `Payout account is "${account.status ?? "unknown"}", not active. ` +
          `Onboarding is unfinished or the processor has restricted it.`,
      })
      continue
    }

    if (!account.external_account_id) {
      unpayable.push({
        ...base,
        reason: "Payout account is active but carries no external account id.",
      })
      continue
    }

    const amount = Number(row.allocation_amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      unpayable.push({
        ...base,
        reason: `Allocation amount is ${row.allocation_amount}; nothing to send.`,
      })
      continue
    }

    payable.push({
      ...base,
      amount,
      currency: row.allocation_currency,
      destination_account_id: account.external_account_id,
      idempotency_key: `patronage:${periodKey}:${row.id}`,
    })
  }

  const currencies = new Set(payable.map((p) => p.currency))

  return {
    period_key: periodKey,
    payable,
    unpayable,
    total_payable: payable.reduce((sum, p) => sum + p.amount, 0),
    currency: currencies.size === 1 ? [...currencies][0] : null,
  }
}
