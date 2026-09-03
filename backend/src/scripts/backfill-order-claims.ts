import type { ExecArgs } from "@medusajs/framework/types"
import { REQUEST_MODULE } from "../modules/request"
import type RequestModuleService from "../modules/request/service"
import { REQUEST_TYPES } from "../modules/request/validators"
import { RequestStatus } from "../modules/request/models"
import { ORDER_DISPUTE_MODULE } from "../modules/order-dispute"
import type OrderDisputeService from "../modules/order-dispute/service"
import {
  CLAIM_METADATA_KEYS,
  claimReasonToDisputeReason,
  isClaimReason,
} from "../modules/order-dispute/claims-compat"
import { openDisputeForOrder } from "../shared/order-dispute-intake"

/**
 * Move still-pending legacy order claims onto `order_dispute`.
 *
 * `POST /store/order-claims` now files disputes, and `GET` lists disputes, so
 * a claim that was filed under the old `request`-backed version and is still
 * pending has vanished from the buyer's claims page and from any admin queue —
 * it sits in `request` with `type = order_claim`, which `/admin/requests` can
 * still show but nothing routes to anymore. Run once after deploying the
 * repoint:
 *
 *     npx medusa exec ./src/scripts/backfill-order-claims.ts
 *
 * Only PENDING claims move. An accepted or rejected legacy claim is a closed
 * case with its decision recorded on the request row; re-opening it as a
 * dispute would put a settled matter back in front of an admin.
 *
 * The legacy row is marked `completed` with a reviewer note naming the dispute
 * it became, rather than deleted — the audit trail of "this was filed on
 * such-and-such a date" stays where it was.
 *
 * Idempotent by `metadata.legacy_request_id` on the dispute: a second run
 * skips anything it already moved.
 *
 * The filing window is NOT re-applied. These claims were accepted when they
 * were filed; failing them now on a window they already passed would punish
 * buyers for the migration. Passed through as a very long window rather than
 * bypassed, so the intake path is still the one path.
 */
export default async function backfillOrderClaims({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const requests = container.resolve<RequestModuleService>(REQUEST_MODULE)
  const disputes = container.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  const pending = (await requests.listRequests({
    type: REQUEST_TYPES.ORDER_CLAIM,
    status: RequestStatus.PENDING,
  })) as unknown as {
    id: string
    submitter_id: string
    data: Record<string, unknown> | null
  }[]

  let moved = 0
  let skipped = 0
  let failed = 0

  for (const legacy of pending) {
    try {
      const already = (await disputes.listOrderDisputes({
        metadata: { legacy_request_id: legacy.id },
      })) as unknown[]
      if (already.length) {
        skipped += 1
        continue
      }

      const data = legacy.data ?? {}
      const orderId = typeof data.order_id === "string" ? data.order_id : ""
      const reason = isClaimReason(data.reason) ? data.reason : "not_as_described"
      const description =
        typeof data.description === "string" && data.description.trim()
          ? data.description
          : "(migrated legacy claim — no description recorded)"

      if (!orderId) {
        failed += 1
        logger.error(`[backfill-order-claims] request ${legacy.id} has no order_id`)
        continue
      }

      const result = await openDisputeForOrder(container, {
        customerId: legacy.submitter_id,
        orderId,
        reason: claimReasonToDisputeReason(reason),
        description,
        windowDays: 36_500,
        metadata: {
          legacy_request_id: legacy.id,
          [CLAIM_METADATA_KEYS.reason]: reason,
          [CLAIM_METADATA_KEYS.evidenceUrls]: Array.isArray(data.evidence_urls)
            ? data.evidence_urls
            : [],
          [CLAIM_METADATA_KEYS.contactedSeller]: data.contacted_seller === true,
          [CLAIM_METADATA_KEYS.source]: "backfill:request",
        },
      })

      if (!result.ok) {
        failed += 1
        logger.error(
          `[backfill-order-claims] request ${legacy.id}: ${result.status} ${JSON.stringify(
            result.body
          )}`
        )
        continue
      }

      await requests.updateRequests({
        id: legacy.id,
        status: RequestStatus.COMPLETED,
        reviewer_note: `Migrated to order_dispute ${result.dispute.id} on 2026-09-03.`,
      })

      moved += 1
    } catch (err) {
      failed += 1
      logger.error(
        `[backfill-order-claims] request ${legacy.id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  logger.info(
    `[backfill-order-claims] moved=${moved} skipped=${skipped} failed=${failed}. ` +
      `Legacy request rows are marked completed, not deleted.`
  )
}
