import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/hawala/payments")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { createVendorPaymentSchema, validateInput } from "../../../hawala-validation"

/**
 * GET /vendor/hawala/payments
 * Get vendor's payment history (both sent and received)
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    // Get payments sent and received
    const [sent, received] = await Promise.all([
      hawalaService.listVendorPayments({
        payer_vendor_id: vendorId,
      }),
      hawalaService.listVendorPayments({
        payee_vendor_id: vendorId,
      }),
    ])

    res.json({
      sent: sent.map(p => ({
        id: p.id,
        payee_vendor_id: p.payee_vendor_id,
        amount: Number(p.amount),
        payment_type: p.payment_type,
        invoice_number: p.invoice_number,
        reference_note: p.reference_note,
        status: p.status,
        created_at: p.created_at,
      })),
      received: received.map(p => ({
        id: p.id,
        payer_vendor_id: p.payer_vendor_id,
        amount: Number(p.amount),
        payment_type: p.payment_type,
        invoice_number: p.invoice_number,
        reference_note: p.reference_note,
        status: p.status,
        created_at: p.created_at,
      })),
    })
  } catch (error: any) {
    log.error("Error getting vendor payments:", error)
    res.status(400).json({ error: "Failed to retrieve payment history" })
  }
}

/**
 * POST /vendor/hawala/payments
 * Create a vendor-to-vendor payment
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
    
    // Get vendor ID from auth context
    const vendorId = (req as any).auth_context?.actor_id
    if (!vendorId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    // Validate input
    const validation = validateInput(createVendorPaymentSchema, req.body)
    if (!validation.success) {
      return res.status(400).json({ error: validation.error })
    }
    const {
      payee_vendor_id,
      amount,
      payment_type,
      invoice_number,
      reference_note,
    } = validation.data

    // SECURITY: Prevent self-payment
    if (payee_vendor_id === vendorId) {
      return res.status(400).json({ error: "Cannot pay yourself" })
    }

    const payment = await hawalaService.createVendorToVendorPayment({
      payer_vendor_id: vendorId,
      payee_vendor_id,
      amount,
      payment_type: payment_type ?? "OTHER",
      invoice_number,
      reference_note,
    })

    res.status(201).json({
      payment: {
        id: payment.id,
        payee_vendor_id: payment.payee_vendor_id,
        amount: Number(payment.amount),
        payment_type: payment.payment_type,
        invoice_number: payment.invoice_number,
        reference_note: payment.reference_note,
        status: payment.status,
        created_at: payment.created_at,
      },
      message: "Payment completed successfully. Funds transferred instantly with zero fees.",
    })
  } catch (error: any) {
    log.error("Error creating vendor payment:", error)
    res.status(400).json({ error: "Failed to process payment" })
  }
}
