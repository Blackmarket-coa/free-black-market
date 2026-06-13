import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/inventory-sync/events")
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { inventoryLedgerEventSchema } from "../../../../shared/phase0-contracts"
import { runQueueConsumer } from "../../../../shared/queue-runtime"
import { requeueWithBackoff } from "../../../../shared/queue-requeue-adapter"

const SYNC_ROUTE_EVENT_CODES = {
  accepted: "INVENTORY_SYNC_ACCEPTED",
  duplicate: "INVENTORY_SYNC_DUPLICATE",
  retried: "INVENTORY_SYNC_RETRIED",
  dead_lettered: "INVENTORY_SYNC_DEAD_LETTERED",
} as const

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payload = inventoryLedgerEventSchema.parse(req.body)

  const result = await runQueueConsumer({
    topicKey: "inventory_sync",
    payload,
    idempotencyKey: payload.idempotency_key,
    handler: async () => undefined,
    publishToDlq: async (message) => {
      log.error("[POST /vendor/inventory-sync/events][DLQ]", JSON.stringify(message))
    },
    requeue: async (message, delaySeconds) => {
      await requeueWithBackoff(message, delaySeconds)
    },
  })

  const transition = payload.transition ?? "update"
  const code = SYNC_ROUTE_EVENT_CODES[result.status]

  res.status(202).json({
    result,
    code,
    topic: "inventory.sync.v1",
    transition,
  })
}
