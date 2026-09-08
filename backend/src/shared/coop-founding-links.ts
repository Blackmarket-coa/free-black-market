import { partnerLinks } from "../modules/partner-directory"
import { appendPath } from "./url"

/**
 * Where a vendor goes for co-op founding documents — bylaws, a member
 * agreement, articles, a patronage or capitalization policy.
 *
 * `docs/CDFI_COOP_ROADMAP.md` §3.4: the templates already ship, in Blackout,
 * as den documents on the Coalition tool sheet. FBM's part is to point at
 * them and at the public libraries they were adapted from, so a vendor who is
 * not on Blackout still has the source material. FBM generates no legal
 * filing and reviews no document; every row here is a link out.
 *
 * Two callers share this list so the vocabulary is stated once: Q11
 * `coop-formation`'s gatekeeper links, and the playbook progression edges
 * whose prose prerequisites name bylaws.
 */

/** Public Blackout web origin when `BLACKOUT_APP_URL` is unset. */
export const BLACKOUT_APP_URL_FALLBACK = "https://theblackout.app"

/**
 * The Blackout web app origin.
 *
 * `BLACKOUT_APP_URL` is the schema-declared variable (`shared/config.ts`) for
 * the user-facing app, as distinct from `BLACKOUT_API_BASE` (the service API).
 * Two older call sites inline this same fallback — the creator stream-overlay
 * route on `BLACKOUT_APP_URL`, and the embed-chat route on the undeclared
 * `BLACKOUT_BASE_URL`. Folding those two into this helper, and settling the
 * variable-name split, is left alone here on purpose: it would change the
 * behaviour of a deploy that sets only `BLACKOUT_BASE_URL`.
 */
export const blackoutAppUrl = (): string =>
  (process.env.BLACKOUT_APP_URL || BLACKOUT_APP_URL_FALLBACK).replace(/\/+$/, "")

/**
 * The Coalition tool sheet, where the Documents tool lives.
 *
 * Blackout's route is a bare `/coalition` — it takes no den or tool
 * parameter, so the link lands on Coalition and the vendor opens Documents
 * from there. A deep link is not available to build.
 */
export const blackoutCoalitionUrl = (): string =>
  appendPath(blackoutAppUrl(), "/coalition") || `${BLACKOUT_APP_URL_FALLBACK}/coalition`

/** The Blackout row on its own, so a caller can label it in context. */
export const blackoutFoundingDocumentsLink = (): { label: string; url: string } => ({
  label: "Blackout — Coalition tools (bylaws, mission and decision-rule seeds)",
  url: blackoutCoalitionUrl(),
})

/**
 * Blackout first, then the public libraries from the §3.2 registry.
 *
 * The registry filter is the same one Q11 already used: co-op-serving legal
 * and back-office rows. Adding a row to `partner-directory/catalog.ts` with
 * `serves: ["cooperative"]` and `kind: "legal"` or `"back_office"` puts it
 * here, on Q11 and on the progression edges at once — there is no second list
 * to keep in step.
 */
export const coopFoundingDocumentLinks = (): { label: string; url: string }[] => [
  blackoutFoundingDocumentsLink(),
  ...partnerLinks({ kind: ["legal", "back_office"], serves: "cooperative" }),
]
