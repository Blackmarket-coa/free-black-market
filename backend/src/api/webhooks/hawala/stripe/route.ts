import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/webhooks/hawala/stripe")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import { createStripeAchService } from "../../../../modules/hawala-ledger/stripe-ach"

/**
 * POST /webhooks/hawala/stripe
 * Handle Stripe ACH webhooks
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const hawalaService = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const signature = req.headers["stripe-signature"] as string
  if (!signature) {
    return res.status(400).json({ error: "Missing Stripe signature" })
  }

  try {
    const achService = createStripeAchService()
    const rawBody = (req as MedusaRequest & { rawBody?: Buffer }).rawBody

    // SECURITY: Require raw body buffer for proper signature verification
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      log.error("Webhook raw body missing or not a buffer - signature verification would be invalid")
      return res.status(400).json({ error: "Invalid request body format" })
    }

    const event = await achService.handleWebhook(rawBody, signature)

    log.info(`Stripe webhook received: ${event.type}`)

    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data
        const ledgerAccountId = paymentIntent.metadata?.ledger_account_id

        if (ledgerAccountId && paymentIntent.metadata?.type === "ach_deposit") {
          // Find the pending ACH transaction
          const transactions = await hawalaService.listAchTransactions({
            stripe_payment_intent_id: paymentIntent.id,
            status: "PENDING",
          })

          if (transactions.length > 0) {
            const txn = transactions[0]
            const fee = parseFloat(paymentIntent.metadata?.fee || "0")
            const netAmount = parseFloat(paymentIntent.metadata?.net_amount || String(txn.amount))

            // Credit the ledger account
            await hawalaService.recordDeposit({
              credit_account_id: txn.ledger_account_id,
              amount: netAmount,
              stripe_payment_intent_id: paymentIntent.id,
              fee,
              idempotency_key: `webhook-${paymentIntent.id}`,
            })

            // Update ACH transaction
            const updateData = {
              id: txn.id,
              status: "SUCCEEDED" as const,
              actual_settlement_date: new Date(),
            }
            await hawalaService.updateAchTransactions(updateData)
          }
        }
        break
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data

        // Find and mark transaction as failed
        const transactions = await hawalaService.listAchTransactions({
          stripe_payment_intent_id: paymentIntent.id,
          status: "PENDING",
        })

        if (transactions.length > 0) {
          const updateData = {
            id: transactions[0].id,
            status: "FAILED" as const,
            failure_reason: paymentIntent.last_payment_error?.message || "Payment failed",
          }
          await hawalaService.updateAchTransactions(updateData)
        }
        break
      }

      case "payout.paid": {
        const payout = event.data
        const ledgerAccountId = payout.metadata?.ledger_account_id

        if (ledgerAccountId && payout.metadata?.type === "ach_payout") {
          // Update ACH transaction
          const transactions = await hawalaService.listAchTransactions({
            stripe_payout_id: payout.id,
          })
          const open = transactions.filter(
            (t) => t.status === "PENDING" || t.status === "PROCESSING"
          )

          if (open.length > 0) {
            const updateData = {
              id: open[0].id,
              status: "SUCCEEDED" as const,
              actual_settlement_date: new Date(),
            }
            await hawalaService.updateAchTransactions(updateData)
          }
        }
        break
      }

      case "payout.failed": {
        const payout = event.data

        const transactions = await hawalaService.listAchTransactions({
          stripe_payout_id: payout.id,
        })
        const open = transactions.filter(
          (t) => t.status === "PENDING" || t.status === "PROCESSING"
        )

        if (open.length > 0) {
          const txn = open[0]

          // Refund the ledger debit
          const reserveAccount = await hawalaService.getOrCreateSystemAccount("RESERVE")
          await hawalaService.createTransfer({
            debit_account_id: reserveAccount.id,
            credit_account_id: txn.ledger_account_id,
            amount: Number(txn.amount),
            entry_type: "REFUND",
            description: "Withdrawal failed - funds returned",
            idempotency_key: `refund-${payout.id}`,
          })

          const failedUpdateData = {
            id: txn.id,
            status: "FAILED" as const,
            failure_reason: payout.failure_message || "Payout failed",
          }
          await hawalaService.updateAchTransactions(failedUpdateData)
        }
        break
      }

      case "financial_connections.account.disconnected": {
        const fcAccount = event.data
        
        // Find and deactivate the bank account
        const bankAccounts = await hawalaService.listBankAccounts({
          stripe_bank_account_id: fcAccount.id,
        })

        if (bankAccounts.length > 0) {
          const bankUpdateData = {
            id: bankAccounts[0].id,
            verification_status: "ERRORED" as const,
            is_default: false,
          }
          await hawalaService.updateBankAccounts(bankUpdateData)
        }
        break
      }

      default:
        log.info(`Unhandled Stripe event type: ${event.type}`)
    }

    res.json({ received: true })
  } catch (error) {
    log.error("Stripe webhook error:", error)
    res.status(400).json({ error: (error as Error).message })
  }
}
