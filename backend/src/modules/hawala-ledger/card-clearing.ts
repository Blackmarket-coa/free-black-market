/**
 * Card clearing: how a card-paid order enters the hawala ledger (SD-36,
 * operator answer 2026-10-06 "do the fix design"; `FF_CARD_ORDER_LEDGER_V1`).
 *
 * Before this, every order's purchase leg debited the customer's USER_WALLET.
 * Medusa's only FBM payment provider is Stripe, so every order is a card
 * order; the wallet is created at $0, `createTransfer` refuses the debit, and
 * the settlement subscriber swallows the error — no card order ever reached
 * the ledger. Funding the wallet is not the fix: a customer-held balance is
 * the balance-holding Posture A rules out (docs/POSTURE_A_COMPLIANCE.md).
 *
 * The clearing account stands for money that came in through FBM's own
 * Stripe account. A card order's purchase leg debits it instead of a wallet:
 *
 *   capture:  CARD_CLEARING -> ESCROW   (PURCHASE, order_id)  then the usual
 *             fee / processing / seller legs out of ESCROW
 *   refund:   ESCROW -> CARD_CLEARING   (REFUND,   order_id)  back to the card
 *
 * It is the ONE account in the ledger allowed below zero: its balance reads
 * as minus the card money received and not refunded, the way an external
 * counterparty account does in any double-entry book. Every other account
 * keeps the `balance >= 0` CAS. Because "may go negative" is exactly what
 * would let an account mint money, the permission is narrow and enforced at
 * the single money-movement chokepoint (`createTransfer`), not by callers:
 *
 *   - Only `account_type` CARD_CLEARING, owner SYSTEM / `stripe` (one per
 *     currency; USD is the only one created), and only on the USD rail.
 *   - Out of it: entry_type PURCHASE, into ESCROW, with an order_id.
 *   - Into it: entry_type REFUND, out of ESCROW, with an order_id.
 *   - Nothing else may touch it — no TRANSFER, no payout, no wallet, no
 *     seller account, never both sides of one leg.
 *
 * So the account can only ever move money between the outside world and the
 * escrow of a specific order. `processRefund` already sends the customer leg
 * back to the purchase leg's debit account, so a card order's refund returns
 * to clearing (the card) and never credits a customer wallet.
 *
 * Settlement timing: FBM's Stripe provider runs in manual capture (no
 * `capture` option in medusa-config), so at `order.placed` card money is only
 * authorised. With the flag on, a card order settles on `payment.captured`
 * once its payment collection is fully captured — no vendor is credited for
 * money that was only authorised. See `subscribers/hawala-card-capture.ts`.
 *
 * Which orders: only payments through FBM's own Stripe registration
 * (`pp_stripe_stripe` and the other `@medusajs/payment-stripe` methods,
 * e.g. `pp_stripe-bancontact_stripe`). A Stripe Connect direct charge
 * (`stripe_connect_direct`, a partner org's own connected account) never
 * passes through FBM's balance and posts nothing here.
 */

export const CARD_CLEARING_ACCOUNT_TYPE = "CARD_CLEARING"
export const CARD_CLEARING_OWNER_ID = "stripe"
/** Stamped on a card order's purchase leg (`metadata.funding`). */
export const CARD_FUNDING = "card"

/** The `id` FBM's Stripe provider is registered under in medusa-config. */
export const FBM_STRIPE_REGISTRATION_ID = "stripe"

/**
 * True for a payment taken through FBM's own Stripe account: Medusa names a
 * provider `pp_<identifier>_<registration id>`, and every method in
 * `@medusajs/payment-stripe` has identifier `stripe` or `stripe-<method>`.
 * Exact shape, so `stripe_connect_direct` (another registration id) and any
 * future provider never match by accident.
 */
export function isFbmCardProvider(providerId: unknown): boolean {
  return (
    typeof providerId === "string" &&
    /^pp_stripe(-[a-z0-9]+)?_stripe$/.test(providerId)
  )
}

export class CardClearingLegError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) {
    super(message)
    this.name = "CardClearingLegError"
  }
}

type AccountLike = {
  id: string
  account_type?: string | null
  owner_type?: string | null
  owner_id?: string | null
  currency_code?: string | null
}

export function isCardClearingAccount(account: AccountLike | null | undefined): boolean {
  return account?.account_type === CARD_CLEARING_ACCOUNT_TYPE
}

/**
 * Refuse every leg touching a clearing account that is not one of the two
 * allowed shapes. Called by `createTransfer` before anything is written.
 * Returns which account (if any) is the clearing account, so the caller lets
 * only that account's balance sit below zero: the debit of a PURCHASE takes
 * it further below, the credit of a REFUND brings it back toward zero.
 */
export function assertCardClearingLeg(
  leg: { entry_type: string; order_id?: string | null },
  debit: AccountLike,
  credit: AccountLike
): { debitIsClearing: boolean; clearingAccountId: string | null } {
  const debitIsClearing = isCardClearingAccount(debit)
  const creditIsClearing = isCardClearingAccount(credit)
  if (!debitIsClearing && !creditIsClearing) return { debitIsClearing: false, clearingAccountId: null }

  const clearing = debitIsClearing ? debit : credit
  const other = debitIsClearing ? credit : debit
  const details = {
    entry_type: leg.entry_type,
    order_id: leg.order_id ?? null,
    debit_account_id: debit.id,
    credit_account_id: credit.id,
  }
  const refuse = (why: string): never => {
    throw new CardClearingLegError(`Card-clearing leg refused: ${why}`, details)
  }

  if (debitIsClearing && creditIsClearing) refuse("both sides are card clearing")
  if (
    clearing.owner_type !== "SYSTEM" ||
    clearing.owner_id !== CARD_CLEARING_OWNER_ID ||
    String(clearing.currency_code ?? "").toUpperCase() !== "USD"
  ) {
    refuse("only the SYSTEM-owned USD card-clearing account may be used")
  }
  if (!leg.order_id) refuse("a card-clearing leg must name its order")
  if (other.account_type !== "ESCROW" || other.owner_type !== "SYSTEM" || other.owner_id !== "system") {
    refuse("the other side must be the order escrow")
  }
  if (debitIsClearing && leg.entry_type !== "PURCHASE") {
    refuse("money leaves card clearing only as a PURCHASE into escrow")
  }
  if (creditIsClearing && leg.entry_type !== "REFUND") {
    refuse("money returns to card clearing only as a REFUND out of escrow")
  }
  return { debitIsClearing, clearingAccountId: clearing.id }
}
