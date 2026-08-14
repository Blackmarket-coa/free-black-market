/**
 * Secret resolution for the inbound Blackstar events receiver — the
 * per-partner half of the verification path, kept pure (lookup injected) so
 * it unit-tests without a container.
 *
 * When the request names a key id, only that credential's secret may verify
 * it; an unknown or revoked key id answers exactly like a bad signature so
 * the endpoint never confirms which key ids exist. Requests without a key id
 * fall back to the deployment-global secret only while
 * BLACKSTAR_REQUIRE_KEY_ID is off — flipping it retires the global secret
 * with no code change. Fail-closed throughout: nothing configured means 503,
 * never an empty-key verification.
 */
export type BridgeSecretLookup = (
  keyId: string
) => Promise<{ id: string; secret: string } | null>

export type SecretResolution =
  | { ok: true; secret: string; credentialId: string | null }
  | { ok: false; status: number; message: string }

export async function resolveBlackstarVerificationSecret(args: {
  keyIdHeader: string | undefined
  lookup: BridgeSecretLookup
  globalSecret: string | undefined
  requireKeyId: boolean
}): Promise<SecretResolution> {
  const keyId = (args.keyIdHeader ?? "").trim()

  if (keyId !== "") {
    const credential = await args.lookup(keyId)
    if (!credential) {
      return { ok: false, status: 401, message: "Invalid signature." }
    }
    return { ok: true, secret: credential.secret, credentialId: credential.id }
  }

  if (args.requireKeyId) {
    return { ok: false, status: 401, message: "Key ID required." }
  }

  if (!args.globalSecret) {
    return {
      ok: false,
      status: 503,
      message: "Blackstar signature verification is not configured.",
    }
  }

  return { ok: true, secret: args.globalSecret, credentialId: null }
}
