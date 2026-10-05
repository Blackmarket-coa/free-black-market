import { SubscriptionStatus } from "./types"

/**
 * A lifecycle transition the subscription's current status does not allow.
 *
 * Thrown by the service layer — the only place that can reliably refuse to
 * write, whatever route or workflow called it. Store routes map it to 409.
 *
 * Detected by `name`/`code`, never by `instanceof`: an error thrown inside a
 * workflow step can reach the route after the orchestrator has serialised it,
 * and a serialised error keeps its enumerable fields but loses its prototype.
 */
export class SubscriptionTransitionError extends Error {
  readonly code = "subscription_transition_not_allowed" as const
  readonly subscription_id: string
  readonly from_status: string
  readonly action: string

  constructor(args: {
    subscription_id: string
    from_status: SubscriptionStatus | string
    action: string
    allowed_from: ReadonlyArray<SubscriptionStatus | string>
  }) {
    super(
      `Cannot ${args.action} subscription ${args.subscription_id}: status is ` +
        `"${args.from_status}", allowed only from ${args.allowed_from
          .map((s) => `"${s}"`)
          .join(", ")}.`
    )
    this.name = "SubscriptionTransitionError"
    this.subscription_id = args.subscription_id
    this.from_status = String(args.from_status)
    this.action = args.action
  }
}

export function isSubscriptionTransitionError(
  error: unknown
): error is { name: string; code: string; message: string } {
  if (!error || typeof error !== "object") return false
  const e = error as { name?: unknown; code?: unknown }
  return (
    e.name === "SubscriptionTransitionError" ||
    e.code === "subscription_transition_not_allowed"
  )
}
