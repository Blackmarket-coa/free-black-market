/**
 * Surplus redirect — letting a buyer send an un-returned pledge to mutual aid
 * instead of taking a plain refund.
 *
 * ## The guardrail, restated because it constrains the code
 *
 * This flow must be **explicit, opt-in, and reversible before finalization —
 * never a default, and never a nudge away from a plain refund.** That is not a
 * UX preference; it is what separates this from a dark pattern that quietly
 * keeps people's money. Three things follow, and none of them are optional:
 *
 *  1. `REFUND` is the default disposition and the value a participant holds
 *     until they say otherwise. Nothing infers `DONATE` — not an archetype, not
 *     a pool setting, not a prior choice on another pool.
 *  2. The choice is reversible right up until the escrow actually moves. Once
 *     released it is final, because the money is gone.
 *  3. There is no server-side path that sets `DONATE` on a participant's behalf.
 *     The only writer is the participant's own explicit request.
 *
 * ## Why the money-moving half is dark
 *
 * Routing a pledge to mutual aid is not a ledger transfer between two FBM
 * accounts. Under Posture A, donations run through a 501(c)(3) fiscal sponsor
 * and FBM is a routing layer that does not hold the donor-recipient
 * relationship (`modules/donation/models/donation-settings.ts`,
 * `docs/POSTURE_A_COMPLIANCE.md`). Moving real money this way also raises
 * money-transmission questions that vary by jurisdiction.
 *
 * So this ships the way `creator-credits.ts` and `campaign-escrow.ts` ship:
 * the mechanic is real and testable, and the ledger side stays dark until
 * `FBM_SURPLUS_REDIRECT_LIVE=1`. With the flag unset, a `DONATE` disposition is
 * recorded and honoured as intent, but the escrow still returns to the buyer —
 * the safe failure direction. Turning the flag on is a compliance decision with
 * a legal sign-off attached, not a deploy step.
 */

export const SURPLUS_REDIRECT_FLAG = "FBM_SURPLUS_REDIRECT_LIVE"

export function isSurplusRedirectLive(): boolean {
  return process.env[SURPLUS_REDIRECT_FLAG] === "1"
}

export const SURPLUS_DISPOSITIONS = ["REFUND", "DONATE"] as const

export type SurplusDisposition = (typeof SURPLUS_DISPOSITIONS)[number]

const DISPOSITION_SET: ReadonlySet<string> = new Set(SURPLUS_DISPOSITIONS)

export function isSurplusDisposition(v: unknown): v is SurplusDisposition {
  return typeof v === "string" && DISPOSITION_SET.has(v)
}

/** The value a participant holds until they explicitly choose otherwise. */
export const DEFAULT_SURPLUS_DISPOSITION: SurplusDisposition = "REFUND"

/**
 * Whether an escrow release should actually route to mutual aid.
 *
 * Both conditions are required, and the flag is checked second on purpose: a
 * participant's recorded intent is meaningful on its own and worth keeping,
 * but it must not move money until the compliance path is open.
 */
export function shouldRouteToMutualAid(
  disposition: string | null | undefined
): boolean {
  return disposition === "DONATE" && isSurplusRedirectLive()
}

/**
 * Ledger account redirected pledges are paid into.
 *
 * Deliberately operator-configured with no default. The obvious shortcut —
 * paying into the platform `RESERVE` — would have FBM holding donated funds,
 * which is the precise arrangement Posture A exists to avoid: the fiscal
 * sponsor holds the donor-recipient relationship, not FBM. Picking a
 * destination is therefore a compliance decision, so the code refuses to guess
 * one.
 *
 * This is why the flag alone cannot switch the feature on. An operator must
 * both open the rail and say where the money goes; enabling the flag without
 * configuring an account fails loudly rather than quietly misrouting funds.
 */
export const MUTUAL_AID_ACCOUNT_ENV = "FBM_MUTUAL_AID_ACCOUNT_ID"

export function getMutualAidAccountId(): string | null {
  const raw = process.env[MUTUAL_AID_ACCOUNT_ENV]
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : null
}

export function requireMutualAidAccountId(): string {
  const id = getMutualAidAccountId()
  if (!id) {
    throw new Error(
      `${SURPLUS_REDIRECT_FLAG} is on but ${MUTUAL_AID_ACCOUNT_ENV} is not set; ` +
        "refusing to route a redirected pledge without a configured destination"
    )
  }
  return id
}
