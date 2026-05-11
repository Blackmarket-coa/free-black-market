import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireSellerId } from "../../../../shared"
import {
  classifyNotification,
  countByBucket,
  NOTIFICATION_BUCKETS,
  type NotificationBucket,
} from "../../../../lib/notification-buckets"

type NotificationRow = {
  id: string
  template: string | null
  data: Record<string, unknown> | null
  created_at: string
}

/**
 * GET /vendor/notifications/buckets
 *
 * Returns per-bucket counts plus the most-recent N notifications in each
 * bucket so the vendor-panel drawer can render three tabs without a
 * second round-trip. The "awaits_me" bucket is the primary signal — the
 * UI is expected to surface its count as a badge on the bell icon.
 *
 * The endpoint is read-only and idempotent. Pagination per bucket is
 * out of scope here; the existing `GET /vendor/notifications` (Mercur
 * native) remains the cursor for deep history.
 *
 * Query params
 *   limit          number   default 5     items per bucket (max 50)
 *   since          ISO date optional      only count rows after this ts
 *
 * Response
 *   {
 *     counts:   { awaits_me, about_me, fyi },
 *     samples:  { awaits_me: NotificationRow[], about_me: [], fyi: [] }
 *   }
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const requested = Number(req.query?.limit)
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), 50)
      : 5

  const sinceRaw = req.query?.since
  const since =
    typeof sinceRaw === "string" && sinceRaw.length > 0 ? sinceRaw : null

  const filters: Record<string, unknown> = {
    channel: "seller_feed",
    to: sellerId,
  }
  if (since) {
    // The query graph accepts Mikro-style operators on dateTime fields.
    filters["created_at"] = { $gte: since }
  }

  const { data } = (await query.graph({
    entity: "notification",
    fields: ["id", "template", "data", "created_at"],
    filters,
    pagination: {
      // Cap the per-call read; the vendor drawer surfaces only the top
      // few. Bucketing N rows in memory is fine for this size.
      take: 500,
      order: { created_at: "DESC" },
    },
  })) as { data: NotificationRow[] }

  const rows = data ?? []

  const counts = countByBucket(rows)

  const samples: Record<NotificationBucket, NotificationRow[]> = {
    awaits_me: [],
    about_me: [],
    fyi: [],
  }

  for (const row of rows) {
    const bucket = classifyNotification(row.template)
    if (samples[bucket].length < limit) {
      samples[bucket].push(row)
    }
    // Early exit when every bucket is full.
    if (NOTIFICATION_BUCKETS.every((b) => samples[b].length >= limit)) {
      break
    }
  }

  return res.json({ counts, samples })
}
