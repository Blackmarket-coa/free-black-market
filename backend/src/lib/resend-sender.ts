/**
 * The address Resend sends FBM's email from (password resets, order
 * confirmations, admin and vendor mail).
 *
 * The code has always read `RESEND_FROM_EMAIL`. Until 2026-11-16
 * `.env.production.example` called the variable `RESEND_FROM` (listed as a
 * landmine in PRE_LAUNCH_AUDIT INFRA-5 and never fixed), so a deployment set up
 * from that template set a variable nothing read, and every email went out
 * from Resend's testing address. Both names are read now; `RESEND_FROM_EMAIL`
 * wins when both are set.
 */
export const RESEND_TESTING_SENDER = "onboarding@resend.dev"

const SENDER_VARIABLES = ["RESEND_FROM_EMAIL", "RESEND_FROM"] as const

export function resendSender(
  env: Record<string, string | undefined> = process.env
): string {
  for (const name of SENDER_VARIABLES) {
    const value = env[name]?.trim()
    if (value && value !== "undefined" && value !== "null") {
      return value
    }
  }
  return RESEND_TESTING_SENDER
}

/**
 * True for an address on resend.dev, Resend's shared testing domain, written
 * bare or as `Name <address>`. Resend's documentation requires a domain you own
 * and have verified (resend.com/domains) to send email, so customers are not
 * expected to receive mail sent from one of these.
 */
export function isResendTestingDomain(from: string): boolean {
  return /@resend\.dev\s*>?\s*$/i.test(from.trim())
}
