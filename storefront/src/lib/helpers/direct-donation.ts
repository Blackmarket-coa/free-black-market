/**
 * The one sentence a donor sees about where a direct-charge donation goes
 * (docs/POSTURE_A_COMPLIANCE.md rule 10). It describes the mechanism — the
 * org's own Stripe account, the org bears the processing fee, BMC takes 0% —
 * and makes no claim about the org's tax status or the deductibility of the
 * gift; that copy comes from the IRS-file badge (`partner-org-badge.ts`).
 */
export const DIRECT_DONATION_DISCLOSURE =
  "The organisation receives your donation directly on its own Stripe account and pays the card processing fee; BMC takes 0%."

/** Where the cart's donation widget hands off to when direct donations are on. */
export const DIRECT_DONATION_PATH = "/donations#direct"
