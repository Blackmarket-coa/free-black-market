import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

/**
 * Whether a vendor may pay another vendor from its earnings here. Off, and
 * only a code change turns it back on: an operator and counsel decide first
 * (Posture A, docs/POSTURE_A_COMPLIANCE.md; SD-145 review).
 *
 * The facts they decide on, as measured:
 *
 *   - `payer_vendor_id` below is the actor, a member id behind the vendor
 *     gate, and createVendorToVendorPayment debits the SELLER_EARNINGS
 *     account owned by that id.
 *   - Member-owned SELLER_EARNINGS accounts exist. Before SD-145,
 *     GET /vendor/farm/grower-dashboard minted one for the calling member on
 *     its first read (getGrowerPayoutHistory, getOrCreateSellerEarnings with
 *     the actor's id); before resolveVendorSellerId, the hawala earnings route
 *     did the same.
 *   - They can hold money: processGroupPurchase (services/collective-hawala.ts)
 *     credits the SELLER_EARNINGS account of a pool's `selected_supplier_id`,
 *     which was a member id for proposals made before SD-145.
 *   - So with a balance there, this route would move USD from a member-owned
 *     account to any `payee_vendor_id` in the body, under reference type
 *     VENDOR_PAYMENT, which is not a purchase context. The Posture A guard
 *     inspects only CCR. Keyed by the store instead, it would move the store's
 *     earnings the same way.
 *
 * Until then every call is refused with 403; the code below is kept as it was.
 * `scripts/rekey-member-keyed-store-data.ts` lists member-owned
 * SELLER_EARNINGS accounts and their balances (MEMBER_OWNED_SELLER_EARNINGS_SQL).
 */
const VENDOR_TO_VENDOR_PAYMENTS_DECIDED = false as boolean

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!VENDOR_TO_VENDOR_PAYMENTS_DECIDED) {
    return res.status(403).json({
      message:
        "Vendor-to-vendor payments are not available. Record the payment outside FBM or invoice the other vendor instead.",
      type: "not_allowed",
    })
  }

  const sellerId = (req as VendorRequest).auth_context?.actor_id
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const { payee_vendor_id, amount, payment_method = "manual", invoice_number, reference_note } = req.body as { payee_vendor_id?: string; amount?: number; payment_method?: string; invoice_number?: string; reference_note?: string }

  if (!payee_vendor_id || !amount) {
    return res.status(400).json({ message: "payee_vendor_id and amount are required" })
  }

  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const payment = await hawalaService.createVendorToVendorPayment({
    payer_vendor_id: sellerId,
    payee_vendor_id,
    amount: Number(amount),
    payment_type: payment_method === "cash" ? "CASH" : "OTHER",
    invoice_number,
    reference_note,
  })

  return res.status(201).json({
    payment: {
      id: payment.id,
      status: payment.status,
      amount: Number(payment.amount),
      invoice_number: payment.invoice_number,
    },
    receipt_export: {
      format: "json",
      payload: {
        payment_id: payment.id,
        amount: Number(payment.amount),
        captured_at: payment.created_at,
      },
    },
  })
}
