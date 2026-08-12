import { QUEUE_TOPICS } from "./queue-topics"
import { validatePhase0Contract } from "./phase0-contracts"
import { checkAndStoreIdempotency } from "./idempotency-store"
import { createLogger } from "./logger"

const log = createLogger("shared/queue-runtime")

export type QueueTopicKey = keyof typeof QUEUE_TOPICS

export type RetryMetadata = {
  attempt: number
  maxRetries: number
  backoffSeconds: number
  nextRetryAt?: string
  failedAt?: string
  lastError?: string
}

export type QueueEnvelope<T> = {
  topic: string
  payload: T
  idempotency_key?: string
  trace_id?: string
  metadata: {
    retry: RetryMetadata
    published_at: string
    dead_letter_topic: string
  }
}

const queueTopicToContract = {
  payments_settlement: "order_sync_event",
  inventory_sync: "inventory_ledger_event",
  invoice_issuance: "invoice",
} as const

export function buildQueueEnvelope<T>(
  topicKey: QueueTopicKey,
  payload: T,
  attempt = 0,
  idempotencyKey?: string
): QueueEnvelope<T> {
  const topic = QUEUE_TOPICS[topicKey]

  return {
    topic: topic.topic,
    payload,
    idempotency_key: idempotencyKey,
    metadata: {
      retry: {
        attempt,
        maxRetries: topic.policy.retries,
        backoffSeconds: topic.policy.backoffSeconds,
      },
      published_at: new Date().toISOString(),
      dead_letter_topic: topic.policy.deadLetterTopic,
    },
  }
}

export function validateTopicPayload(topicKey: QueueTopicKey, payload: unknown) {
  const contractKey = queueTopicToContract[topicKey as keyof typeof queueTopicToContract]
  if (contractKey) {
    validatePhase0Contract(contractKey, payload)
  }
}

export async function runQueueConsumer<T>(params: {
  topicKey: QueueTopicKey
  payload: T
  idempotencyKey?: string
  attempt?: number
  handler: (payload: T) => Promise<void>
  publishToDlq: (message: QueueEnvelope<T>) => Promise<void>
  requeue: (message: QueueEnvelope<T>, delaySeconds: number) => Promise<void>
}) {
  const {
    topicKey,
    payload,
    handler,
    publishToDlq,
    requeue,
    idempotencyKey,
  } = params
  const attempt = params.attempt ?? 0
  const contract = QUEUE_TOPICS[topicKey]

  validateTopicPayload(topicKey, payload)

  const idemCheck = await checkAndStoreIdempotency({
    scope: topicKey,
    idempotencyKey,
    payload,
  })

  // `checkAndStoreIdempotency` degrades to a per-process Map when the shared
  // store is unreachable. That is a real guard for one instance and no guard at
  // all across a multi-instance deploy — a replay routed elsewhere sees an
  // empty map and runs the handler again. The store reports it; until now
  // nothing here acted on it, so the exposure was invisible to operators and
  // untestable by callers.
  //
  // The run is not aborted: refusing to process would convert a cache outage
  // into a queue outage. It is surfaced instead, on every return path, so a
  // consumer can decide and an alert can fire.
  const degraded = idemCheck.degraded === true
  if (degraded) {
    log.warn(
      `[queue] "${topicKey}" processed without cross-instance replay protection: ` +
        "the shared idempotency store was unreachable and the check fell back " +
        "to per-process memory. Duplicate deliveries routed to another instance " +
        "will not be caught.",
      { topic: topicKey, idempotency_key: idempotencyKey ?? null }
    )
  }

  if (idemCheck.duplicate && !idemCheck.conflict) {
    return { status: "duplicate" as const, retries: attempt, degraded }
  }

  if (idemCheck.duplicate && idemCheck.conflict) {
    return {
      status: "idempotency_conflict" as const,
      retries: attempt,
      degraded,
      error: idemCheck.message,
    }
  }

  try {
    await handler(payload)
    return { status: "processed" as const, retries: attempt, degraded }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const nextAttempt = attempt + 1

    if (nextAttempt > contract.policy.retries) {
      await publishToDlq({
        ...buildQueueEnvelope(topicKey, payload, nextAttempt, idempotencyKey),
        metadata: {
          retry: {
            attempt: nextAttempt,
            maxRetries: contract.policy.retries,
            backoffSeconds: contract.policy.backoffSeconds,
            failedAt: new Date().toISOString(),
            lastError: message,
          },
          published_at: new Date().toISOString(),
          dead_letter_topic: contract.policy.deadLetterTopic,
        },
      })

      return {
        status: "dlq" as const,
        retries: nextAttempt,
        degraded,
        error: message,
      }
    }

    const retryEnvelope = buildQueueEnvelope(topicKey, payload, nextAttempt, idempotencyKey)
    await requeue(retryEnvelope, contract.policy.backoffSeconds)

    return {
      status: "retry" as const,
      retries: nextAttempt,
      degraded,
      nextRetryAt: new Date(Date.now() + contract.policy.backoffSeconds * 1000).toISOString(),
      error: message,
    }
  }
}
