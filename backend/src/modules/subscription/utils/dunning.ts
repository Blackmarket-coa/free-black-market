/**
 * Pure-function dunning decision utilities for the subscription renewal
 * pipeline. Kept free of MedusaService imports so they can be unit-tested
 * without container or DB plumbing.
 */

export const DEFAULT_DUNNING_MAX_ATTEMPTS = 3
export const DEFAULT_DUNNING_RETRY_DAYS = [1, 3, 7]

export type DunningDecision =
  | { kind: "pause"; reason: string }
  | { kind: "retry"; days: number; next_retry_at: Date }

export type DecideDunningArgs = {
  attempts: number
  max_attempts?: number
  retry_days?: number[]
  now?: Date
  error?: string | null
}

/**
 * Decide what to do after `attempts` cumulative failed renewal attempts:
 *   - if attempts >= max_attempts → pause the subscription
 *   - otherwise → schedule a retry `days` from now using the backoff
 *     schedule (last value re-used for any overflow attempts)
 */
export function decideDunningAction(args: DecideDunningArgs): DunningDecision {
  const maxAttempts = args.max_attempts ?? DEFAULT_DUNNING_MAX_ATTEMPTS
  const retryDays =
    args.retry_days && args.retry_days.length > 0
      ? args.retry_days
      : DEFAULT_DUNNING_RETRY_DAYS

  if (args.attempts >= maxAttempts) {
    return {
      kind: "pause",
      reason: `payment_failed_after_${args.attempts}_attempts: ${
        args.error ?? "unknown"
      }`,
    }
  }

  const dayIndex = Math.min(Math.max(args.attempts - 1, 0), retryDays.length - 1)
  const days = retryDays[dayIndex] ?? retryDays[retryDays.length - 1]
  const base = (args.now ?? new Date()).getTime()
  const nextRetryAt = new Date(base + days * 24 * 60 * 60 * 1000)

  return { kind: "retry", days, next_retry_at: nextRetryAt }
}
