import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { ccrCartIdempotencyKey } from "./ccr-checkout"

/**
 * Ledger legs for spending Coalition Credits on a cart.
 *
 * Companion to `lib/ccr-checkout.ts`, which holds the arithmetic. This file
 * holds the movements, and mirrors `lib/creator-hub.ts` for account-factory
 * shape and for the `as any` service casts (the generated CRUD types drift
 * from the runtime surface; creator-hub documents the same compromise).
 *
 * ## Resolving the rails.ts drift, deliberately
 *
 * `docs/CCR_HRS_IGNITION.md` §2 flags that `rails.ts:94` declares CCR lives on
 * `USER_WALLET` while the only CCR account factory makes `CREATOR_EARNINGS`,
 * and says the drift "must be resolved deliberately, not papered over".
 *
 * This resolves it **in the direction the registry already declares**: a buyer
 * holds credits in a `USER_WALLET`. That is the reading the reconciler already
 * assumes (`asset-graph/reconciler.ts` looks up `USER_WALLET`+CCR and finds
 * nothing today), so it is the choice that makes an existing consumer correct
 * rather than requiring a second change. The creator-side
 * `CREATOR_EARNINGS`-CCR account is left exactly as it is: a creator's
 * *earnings* account is a different thing from a member's spending wallet, and
 * `getCreatorCcrAccounts` matches on owner+currency so it keeps finding it.
 *
 * ## Why settle burns
 *
 * A spent credit is extinguished, not paid to anyone: the vendor is made whole
 * in cash on the USD rail by the ordinary order settlement, and the platform
 * carries the difference. Burning at settle is what stops one credit being
 * spent on two carts. `BURN` is in `ISSUER_ENTRY_TYPES`, so it is an issuer
 * operation exempt from the purchase-context requirement — but the leg still
 * records the order it settled, because an unattributed burn is not auditable.
 */

const CCR = "CCR"

type LedgerAccount = {
  id: string
  currency_code?: string | null
  available_balance?: number | string | null
}

/**
 * Get or create a buyer's CCR spending wallet: `USER_WALLET` / `CUSTOMER`,
 * denominated in CCR. Lookup is by owner + currency so a wallet of any
 * account_type is reused rather than duplicated — the same tolerance
 * `getCreatorCcrAccounts` applies on the creator side.
 */
export async function getOrCreateCustomerCcrWallet(
  hawala: HawalaLedgerModuleService,
  customerId: string
): Promise<LedgerAccount> {
  const existing = (await (hawala as any).listLedgerAccounts({
    owner_id: customerId,
    owner_type: "CUSTOMER",
    currency_code: CCR,
  })) as LedgerAccount[]
  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0]
  }
  return (await (hawala as any).createAccount({
    account_type: "USER_WALLET",
    owner_type: "CUSTOMER",
    owner_id: customerId,
    currency_code: CCR,
  })) as LedgerAccount
}

/**
 * Get or create the platform's CCR cart-escrow account. Reservations rest here
 * between apply and settle/release, so a credit is neither spendable from the
 * wallet nor extinguished while a cart is open. Shape mirrors
 * `getOrCreateCcrIssuerAccount`, including the `owner_id: "system"` pinning
 * and the currency filter that `getOrCreateSystemAccount` lacks — without it a
 * USD escrow would be returned for a CCR flow.
 */
export async function getOrCreateCcrCartEscrow(
  hawala: HawalaLedgerModuleService
): Promise<LedgerAccount> {
  const existing = (await (hawala as any).listLedgerAccounts({
    account_type: "ESCROW",
    owner_type: "SYSTEM",
    owner_id: "system",
    currency_code: CCR,
  })) as LedgerAccount[]
  if (Array.isArray(existing) && existing.length > 0) {
    return existing[0]
  }
  return (await (hawala as any).createAccount({
    account_type: "ESCROW",
    owner_type: "SYSTEM",
    owner_id: "system",
    currency_code: CCR,
  })) as LedgerAccount
}

/**
 * Reserve credits against an open cart: buyer wallet → cart escrow.
 *
 * `reference_type: "CART"` is the point of the whole exercise. The Posture A
 * guard has blessed `CART` as a purchase context since it was written,
 * specifically so a cart-time reservation could clear the closed-loop check,
 * and until now nothing posted one — the permission existed for a mechanism
 * that was never built (`docs/CCR_HRS_IGNITION.md` §3).
 *
 * `createTransfer` refuses to overdraw, so a buyer cannot reserve credits they
 * do not hold even if a stale quote says otherwise; the balance check is the
 * ledger's, not this caller's.
 */
export async function reserveCartCredits(
  hawala: HawalaLedgerModuleService,
  args: { cartId: string; customerId: string; credits: number }
): Promise<{ entryId: string | null }> {
  const wallet = await getOrCreateCustomerCcrWallet(hawala, args.customerId)
  const escrow = await getOrCreateCcrCartEscrow(hawala)

  const entry = (await (hawala as any).createTransfer({
    debit_account_id: wallet.id,
    credit_account_id: escrow.id,
    amount: args.credits,
    entry_type: "TRANSFER",
    reference_type: "CART",
    reference_id: args.cartId,
    description: `Coalition Credits reserved for cart ${args.cartId}`,
    idempotency_key: ccrCartIdempotencyKey.apply(args.cartId, args.credits),
  })) as { id?: string } | null

  return { entryId: entry?.id ?? null }
}

/**
 * Return a reservation to the buyer: cart escrow → buyer wallet. Used when a
 * cart is abandoned, expires, or the buyer lowers the credits applied.
 *
 * Release is the compensating leg for reserve and must stay total: a credit
 * that cannot get back out of escrow is a credit the buyer lost to a cart they
 * never completed.
 */
export async function releaseCartCredits(
  hawala: HawalaLedgerModuleService,
  args: { cartId: string; customerId: string; credits: number }
): Promise<{ entryId: string | null }> {
  const wallet = await getOrCreateCustomerCcrWallet(hawala, args.customerId)
  const escrow = await getOrCreateCcrCartEscrow(hawala)

  const entry = (await (hawala as any).createTransfer({
    debit_account_id: escrow.id,
    credit_account_id: wallet.id,
    amount: args.credits,
    entry_type: "REFUND",
    reference_type: "CART",
    reference_id: args.cartId,
    description: `Coalition Credits released from cart ${args.cartId}`,
    idempotency_key: ccrCartIdempotencyKey.release(args.cartId),
  })) as { id?: string } | null

  return { entryId: entry?.id ?? null }
}

/**
 * Extinguish a reservation once its order is placed: cart escrow → CCR issuer.
 *
 * The order it settled is recorded even though `BURN` is issuer-exempt from
 * the purchase-context requirement — the exemption is about what the guard
 * demands, not about what an auditor needs.
 */
export async function settleCartCredits(
  hawala: HawalaLedgerModuleService,
  args: { cartId: string; orderId: string; credits: number },
  issuerAccountId: string
): Promise<{ entryId: string | null }> {
  const escrow = await getOrCreateCcrCartEscrow(hawala)

  const entry = (await (hawala as any).createTransfer({
    debit_account_id: escrow.id,
    credit_account_id: issuerAccountId,
    amount: args.credits,
    entry_type: "BURN",
    reference_type: "ORDER",
    reference_id: args.orderId,
    description: `Coalition Credits spent on order ${args.orderId}`,
    idempotency_key: ccrCartIdempotencyKey.settle(args.cartId),
  })) as { id?: string } | null

  return { entryId: entry?.id ?? null }
}
