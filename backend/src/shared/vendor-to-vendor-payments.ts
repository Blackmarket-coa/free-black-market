/**
 * Whether a vendor may pay another vendor from its earnings. Off, and only a
 * code change turns it back on: an operator and counsel decide first
 * (Posture A, docs/POSTURE_A_COMPLIANCE.md; SD-145 review). This is the one
 * switch for every route that makes that transfer.
 *
 * Two vendor routes make it, and each refuses every call with
 * VENDOR_TO_VENDOR_PAYMENTS_REFUSAL as its handler's first statement, the code
 * after it kept as it was:
 *
 *   - POST /vendor/pos/checkout (api/vendor/pos/checkout/route.ts), behind
 *     FF_POS_V1. The payer is `auth_context.actor_id`, a member id behind the
 *     vendor gate, so it debits the SELLER_EARNINGS account that member id
 *     owns.
 *   - POST /vendor/hawala/payments (api/vendor/hawala/payments/route.ts),
 *     behind FF_INVOICING_V1, the `vendor.invoicing` plan feature and the
 *     hawala money rate limit. The payer is the caller's store
 *     (resolveVendorSellerId), so it debits the store's own earnings. The body
 *     picks `payment_type` GOODS | SERVICES | LOAN | OTHER; nothing ties any of
 *     them to an order. Measured in review at c00d39b1: store A's member paid
 *     store B 5 as a LOAN, got 201, and A's earnings went 40 -> 35, B's
 *     0 -> 5.
 *
 * Both call createVendorToVendorPayment (modules/hawala-ledger/service.ts),
 * which moves USD from the payer's SELLER_EARNINGS account to the payee's,
 * under reference type VENDOR_PAYMENT. That is not a purchase context, and the
 * Posture A guard inspects only CCR, so nothing in the service refuses it.
 *
 * The other facts the decision needs, as measured:
 *
 *   - Member-owned SELLER_EARNINGS accounts exist. Before SD-145,
 *     GET /vendor/farm/grower-dashboard minted one for the calling member on
 *     its first read (getGrowerPayoutHistory, getOrCreateSellerEarnings with
 *     the actor's id); before resolveVendorSellerId, the hawala earnings route
 *     did the same.
 *   - They can hold money: processGroupPurchase (services/collective-hawala.ts)
 *     credits the SELLER_EARNINGS account of a pool's `selected_supplier_id`,
 *     which was a member id for proposals made before SD-145.
 *   - `scripts/rekey-member-keyed-store-data.ts` lists those accounts and their
 *     balances (MEMBER_OWNED_SELLER_EARNINGS_SQL) and rewrites none of them.
 *
 * Looked at and not refused, because none is a vendor-to-vendor transfer
 * outside a purchase: invoice payments (accounts-receivable bookkeeping, no
 * ledger), funds (fund accounting, no ledger), aid-network transfers (goods
 * between nodes, no money), collective routes (proposals and order cycles; the
 * pool's payment, processGroupPurchase, is admin-triggered and a purchase),
 * creator credits convert-xp and withdraw (issuer mint and burn), and
 * hawala/pools/[id]/withdraw (a vendor's own pool to its own earnings).
 * Payout split rules can name another vendor's ledger account, but
 * processSplitPayout has no caller.
 *
 * GET /vendor/hawala/payments (payment history) is not affected. The vendor
 * panel's useCreateVendorPayment hook (vendor-panel/src/hooks/api/hawala.ts)
 * POSTs to the hawala route and no page uses it; GET /vendor/pos/config still
 * names that route as `create_payment`.
 */
export const VENDOR_TO_VENDOR_PAYMENTS_DECIDED = false as boolean

/** The 403 body both routes answer while the decision is open. */
export const VENDOR_TO_VENDOR_PAYMENTS_REFUSAL = Object.freeze({
  message:
    "Vendor-to-vendor payments are not available. Record the payment outside FBM or invoice the other vendor instead.",
  type: "not_allowed",
})
