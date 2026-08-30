/**
 * Decision logic for which Matrix identity a customer gets (W2,
 * docs/contracts/mas-identity-consumer.md).
 *
 * Two sources exist:
 *  - "oidc": the customer signed in through the `mas` auth provider, so the
 *    IdP already owns their Matrix account and told us the mxid
 *    (auth identity user_metadata.mxid). Authoritative — provisioning a
 *    second account from the email would fork their identity.
 *  - "derived": legacy email-local-part provisioning via the Synapse admin
 *    API (subscribers/customer-created-matrix.ts ensureUser path).
 *
 * Pure module so the precedence rules are unit-testable without a container.
 */

export type MxidSource = "oidc" | "derived"

export type MxidPlan =
  | { source: "oidc"; mxid: string; localpart: string }
  | { source: "derived"; localpart: string }

// Full mxid shape: @localpart:server (no whitespace, one leading @).
const MXID_RE = /^@([^:@\s]+):(\S+)$/

export const parseMxid = (value: unknown): { mxid: string; localpart: string } | null => {
  if (typeof value !== "string") return null
  const match = MXID_RE.exec(value.trim())
  if (!match) return null
  return { mxid: match[0], localpart: match[1] }
}

/**
 * Pick the Matrix identity for a customer: a valid OIDC-provided mxid always
 * wins; otherwise fall back to deriving a localpart from the email local
 * part (the pre-W2 behavior, byte-identical).
 */
export const pickMxid = (input: { oidcMxid?: unknown; email: string }): MxidPlan => {
  const parsed = parseMxid(input.oidcMxid)
  if (parsed) {
    return { source: "oidc", ...parsed }
  }
  return { source: "derived", localpart: input.email.split("@")[0] }
}

/**
 * Persistence guard for customer.metadata.{mxid,mxid_source}:
 *  - nothing stored yet → write;
 *  - "oidc" is authoritative → may overwrite anything (including refreshing a
 *    previous "oidc" value);
 *  - "derived" keeps the original write-once behavior → never overwrites an
 *    existing mxid, whatever its source ("oidc" is only replaceable by
 *    "oidc").
 */
export const shouldWriteMxid = (
  existingMetadata: Record<string, unknown> | null | undefined,
  nextSource: MxidSource
): boolean => {
  const existing = existingMetadata?.mxid
  const hasExisting = typeof existing === "string" && existing.length > 0
  if (!hasExisting) return true
  return nextSource === "oidc"
}
