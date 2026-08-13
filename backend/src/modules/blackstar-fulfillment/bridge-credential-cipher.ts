import { createCredentialCipher } from "../../shared/credential-cipher"

/**
 * The cipher guarding partner machine credentials for the federated-logistics
 * bridge. Same posture as `channelCredentialCipher`: a dedicated key
 * (`BRIDGE_CREDENTIAL_KEY`, `_PREVIOUS` for rotation) with a loud one-time
 * fallback to `JWT_SECRET` — partner bridge secrets and session signing are
 * different trust domains, and the salt keeps the derived key distinct from
 * every other credential class even under the shared-secret fallback.
 */
export const bridgeCredentialCipher = createCredentialCipher({
  envKeys: ["BRIDGE_CREDENTIAL_KEY", "BRIDGE_CREDENTIAL_KEY_PREVIOUS"],
  fallbackEnvKeys: ["JWT_SECRET"],
  salt: "blackstar-bridge-credential",
  label: "bridge partner",
})
