import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_SIGNING_MODULE } from "../../../../modules/marketplace-signing"
import type PluginSigningService from "../../../../modules/marketplace-signing/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PluginSigningService>(
    MARKETPLACE_SIGNING_MODULE
  )

  try {
    const { keyId, pem } = service.getPublicKeyPem()
    return res.json({
      keys: [
        {
          keyId,
          alg: "ed25519",
          publicKeyPem: pem,
        },
        // Retired keys sign nothing and are published so artifacts signed
        // before a rotation still verify (W3-2). Same set as the
        // /.well-known document, minus its base64 SPKI field, which is only
        // there for the Blackout client's WebCrypto import.
        ...service.getRetiredPublicKeys().map((key) => ({
          keyId: key.keyId,
          alg: "ed25519" as const,
          publicKeyPem: key.pem,
          retired: true as const,
        })),
      ],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return res.status(503).json({ message, type: "signing_unavailable" })
  }
}
