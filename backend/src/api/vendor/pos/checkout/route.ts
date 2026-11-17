import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Deliberately still the actor, which behind the vendor gate is a member id,
  // not the store (SD-145; every other route on the row now takes the store).
  // `payer_vendor_id` names the hawala SELLER_EARNINGS account this debits.
  // Earnings accrue under the store id, so as keyed the payer's account is not
  // found and the payment fails before anything moves. Keyed by the store, it
  // would move the store's earnings to another vendor's account under
  // reference type VENDOR_PAYMENT, which is not a purchase context. Turning
  // that on is an operator and counsel decision (Posture A,
  // docs/POSTURE_A_COMPLIANCE.md), not part of a keying fix.
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
