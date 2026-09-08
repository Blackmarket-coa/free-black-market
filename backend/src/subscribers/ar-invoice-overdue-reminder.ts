import { SubscriberArgs, type SubscriberConfig } from "@medusajs/medusa"
import { createLogger } from "../shared/logger"
import {
  deliverSellerReminders,
  SELLER_REMINDER_TEMPLATES,
  type SellerReminder,
} from "../shared/seller-reminders"

const log = createLogger("subscribers/ar-invoice-overdue-reminder")

/**
 * The subscriber `ar.invoice.overdue` never had.
 *
 * `jobs/ar-dunning-sweep.ts` has emitted this event at five ladder stages
 * (1, 7, 14, 30 and 60 days past due) since accounts-receivable shipped, and
 * its own docblock recorded the problem: "`ar.invoice.overdue` currently has NO
 * subscriber anywhere in the repo, and there is no notification template for
 * it". That is why the sweep runs dry by default under `FBM_AR_DUNNING_LIVE` —
 * advancing `last_dunning_stage` while nothing could deliver would burn each
 * stage on a reminder the seller could never receive, and the ladder only ever
 * moves forward.
 *
 * This is the reader. It does not compose email: the sweep "chases, it does not
 * compose email", and this decides what a reminder looks like — one row on the
 * seller's feed, in the `awaits_me` bucket.
 *
 * ON THE TWO FLAGS. `FBM_AR_DUNNING_LIVE` still gates the *sweep*, and is
 * deliberately left in place. Its docblock says to delete it once a subscriber
 * exists, and a subscriber now does — but deleting it here would start chasing
 * real buyers as a side effect of building a rail, which is an operator's call
 * and not this change's to make. `FF_SELLER_REMINDERS_V1` gates *delivery*. So
 * turning the rail on is two deliberate switches, and neither one alone sends
 * anything a seller was not already going to be told about.
 *
 * Never throws. A failed reminder must not fail the event.
 */
type OverduePayload = {
  invoice_id: string
  seller_id: string
  customer_id: string | null
  stage: number | string
  outstanding: number
  currency_code: string
  due_at: string | Date | null
}

export default async function arInvoiceOverdueReminder({
  event: { data },
  container,
}: SubscriberArgs<OverduePayload>) {
  try {
    if (!data?.seller_id || !data?.invoice_id) {
      log.warn(
        `[ar-overdue-reminder] ignoring event with no seller_id or invoice_id`
      )
      return
    }

    // The dunning ladder's stage is the reminder's stage, so the two records
    // agree: the invoice's `last_dunning_stage` and the feed row's `stage`
    // describe the same rung. Coerced because `DunningStage` is carried
    // through the event bus and may arrive as a string.
    const stage = Number(data.stage)

    const reminder: SellerReminder = {
      seller_id: data.seller_id,
      template: SELLER_REMINDER_TEMPLATES.INVOICE_OVERDUE,
      subject_id: data.invoice_id,
      stage: Number.isFinite(stage) ? stage : 0,
      data: {
        invoice_id: data.invoice_id,
        customer_id: data.customer_id ?? null,
        outstanding: data.outstanding,
        currency_code: data.currency_code,
        due_at: data.due_at instanceof Date ? data.due_at.toISOString() : data.due_at,
      },
    }

    const result = await deliverSellerReminders(container, [reminder])

    if (result.failed > 0) {
      log.error(
        `[ar-overdue-reminder] invoice ${data.invoice_id}: delivery failed`
      )
    }
  } catch (err) {
    log.error(
      `[ar-invoice-overdue-reminder] failed for invoice ${data?.invoice_id}:`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "ar.invoice.overdue",
}
