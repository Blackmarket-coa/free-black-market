/**
 * Shared facts for the three legal pages.
 *
 * One module so Terms, Privacy and Refunds cannot state different effective
 * dates, different contact addresses or different claim windows. The pages
 * import from here; nothing is retyped.
 *
 * ## Placeholders are deliberate and are enforced
 *
 * Values wrapped in doubled square brackets are facts about the operator that
 * code cannot know: the legal entity, where it is organised, the addresses a
 * notice must be sent to. They are left as visible tokens rather than plausible
 * guesses, because a guessed jurisdiction in a governing-law clause is worse
 * than an obvious blank — it reads as settled and is wrong.
 *
 * `scripts/check-legal-placeholders.mjs` fails if any token survives into a
 * build. That is what stops these pages shipping half-filled: the gate is a
 * script, not a promise to remember.
 *
 * ## These drafts have not been reviewed by a lawyer
 *
 * They are written against what the code actually does — the payment flow in
 * `docs/POSTURE_A_COMPLIANCE.md`, the claim window the backend enforces, the
 * data the export and deletion endpoints really touch — which is the part an
 * outside lawyer cannot supply and would otherwise have to guess at. Review is
 * still required. `LEGAL_REVIEW_STATUS` renders that on the page rather than
 * leaving it in a commit message.
 */

/** Operator identity. Every one of these is an operator decision. */
export const LEGAL_ENTITY = "[[LEGAL_ENTITY_NAME]]"
export const LEGAL_ENTITY_FORM = "[[ENTITY_FORM_AND_STATE]]"
export const LEGAL_ADDRESS = "[[REGISTERED_POSTAL_ADDRESS]]"
export const GOVERNING_LAW = "[[GOVERNING_LAW_STATE]]"
export const DISPUTE_VENUE = "[[COURTS_OR_ARBITRATION_FORUM]]"

/**
 * Contact addresses.
 *
 * The repository currently disagrees with itself — `support@freeblackmarket.com`
 * in the vendor panel, `bmc@blackmarketcoa.com` in the Resend setup notes, and
 * `vendor-pilot@freeblackmarket.local` in the pilot runbook, which is not a
 * deliverable address at all. A legal page must name an inbox someone reads,
 * so these stay tokens until one is confirmed.
 */
export const CONTACT_LEGAL = "[[LEGAL_CONTACT_EMAIL]]"
export const CONTACT_PRIVACY = "[[PRIVACY_CONTACT_EMAIL]]"
export const CONTACT_SUPPORT = "[[SUPPORT_CONTACT_EMAIL]]"

/**
 * Minimum age to hold an account.
 *
 * 18 is the draft position and is not arbitrary: accounts can hold a ledger
 * balance, receive payouts and enter binding purchases, and a minor cannot be
 * bound by these terms in most US states. Lowering it means separating the
 * buying account from the earning one, which is a product change and not a
 * wording change.
 */
export const MINIMUM_AGE = 18

/**
 * Whether the operator knowingly serves the EU/UK.
 *
 * Left as a token because the answer changes which regime applies, and the
 * honest answer is not visible from the code: the storefront is
 * locale-routed and reachable worldwide, which is not the same as offering
 * goods to EU data subjects in the GDPR sense.
 */
export const SERVES_EU_UK = "[[SERVES_EU_UK_YES_OR_NO]]"

/** Last substantive revision of the three pages. Bump when the text changes. */
export const LEGAL_EFFECTIVE_DATE = "13 September 2026"

/**
 * Rendered at the top of every legal page while review is outstanding.
 * Set to `null` once a lawyer has signed the text off; the banner disappears
 * and nothing else changes.
 */
export const LEGAL_REVIEW_STATUS: string | null =
  "Draft — written against how the platform actually works, but not yet reviewed by a lawyer. Do not rely on it as legal advice, and do not open to the public until review is complete."

/** Greppable token pattern. Kept here so the check script and the pages agree. */
export const PLACEHOLDER_PATTERN = /\[\[[A-Z0-9_]+\]\]/

/**
 * Storefront path of the privacy policy. The consent banner and every other
 * surface that points at the policy import this so a rename cannot leave a
 * dangling link behind.
 */
export const PRIVACY_POLICY_PATH = "/legal/privacy"
