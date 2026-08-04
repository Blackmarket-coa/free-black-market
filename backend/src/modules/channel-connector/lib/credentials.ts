import { createCredentialCipher } from "../../../shared/credential-cipher"

/**
 * The cipher guarding a vendor's channel access tokens.
 *
 * `CHANNEL_CREDENTIAL_KEY` is what should be set, and `JWT_SECRET` is what
 * happens if nobody does. The separation matters — session signing and
 * credential storage are different trust domains, and a leaked signing secret
 * should not also hand over every vendor's marketplace token — but the
 * consequence of refusing to start without the dedicated key is that connecting
 * a channel breaks on upgrade, and a broken connect flow gets worked around in
 * ways nobody reviews. The fallback warns once, loudly, and is still a long way
 * better than the plaintext column it replaces.
 *
 * `CHANNEL_CREDENTIAL_KEY_PREVIOUS` exists so the key can actually be rotated.
 * A single-name scheme makes rotation an outage, which in practice means it
 * never happens and the key that was in the environment on day one is still
 * there years later.
 *
 * The salt is channel-specific, so even under the shared-secret fallback the
 * derived key is not the same one any other subsystem uses.
 */
export const channelCredentialCipher = createCredentialCipher({
  envKeys: ["CHANNEL_CREDENTIAL_KEY", "CHANNEL_CREDENTIAL_KEY_PREVIOUS"],
  fallbackEnvKeys: ["JWT_SECRET"],
  salt: "channel-connector-credential",
  label: "channel connection",
})
