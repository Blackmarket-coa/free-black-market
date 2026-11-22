import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../../types"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import {
  VENDOR_TO_VENDOR_PAYMENTS_DECIDED,
  VENDOR_TO_VENDOR_PAYMENTS_REFUSAL,
} from "../../../../shared/vendor-to-vendor-payments"

/**
 * POST /vendor/pos/checkout: a vendor-to-vendor payment from the caller's
 * earnings. Refused with 403 until an operator and counsel decide; the switch
 * and the facts they decide on are in shared/vendor-to-vendor-payments.ts.
 * The code after the refusal is kept as it was.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!VENDOR_TO_VENDOR_PAYMENTS_DECIDED) {
    return res.status(403).json(VENDOR_TO_VENDOR_PAYMENTS_REFUSAL)
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
