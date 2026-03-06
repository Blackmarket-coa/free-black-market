export type QueuePolicy = {
  retries: number
  backoffSeconds: number
  deadLetterTopic: string
}

export type QueueTopicContract = {
  topic: string
  purpose: string
  policy: QueuePolicy
}

/**
 * Phase 0 queue and dead-letter topic contracts for critical flows.
 */
export const QUEUE_TOPICS: Record<string, QueueTopicContract> = {
  payments_settlement: {
    topic: "payments.settlement.v1",
    purpose: "Process payment settlement and payout side effects",
    policy: {
      retries: 5,
      backoffSeconds: 30,
      deadLetterTopic: "payments.settlement.dlq.v1",
    },
  },
  inventory_sync: {
    topic: "inventory.sync.v1",
    purpose: "Project inventory updates across channels",
    policy: {
      retries: 8,
      backoffSeconds: 15,
      deadLetterTopic: "inventory.sync.dlq.v1",
    },
  },
  invoice_issuance: {
    topic: "invoice.issuance.v1",
    purpose: "Generate and distribute invoice artifacts and notifications",
    policy: {
      retries: 6,
      backoffSeconds: 20,
      deadLetterTopic: "invoice.issuance.dlq.v1",
    },
  },
  prediction_payout_processing: {
    topic: "prediction.payout.retry.execute.v1",
    purpose: "Retry payout-processing for prediction settlements with backoff",
    policy: {
      retries: 2,
      backoffSeconds: 60,
      deadLetterTopic: "prediction.payout.retry.dlq.v1",
    },
  },
}

export const DLQ_TOPICS = Object.values(QUEUE_TOPICS).map((topic) => topic.policy.deadLetterTopic)
