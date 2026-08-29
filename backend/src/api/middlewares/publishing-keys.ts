import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MARKETPLACE_SIGNING_MODULE } from "../../modules/marketplace-signing"
import type PluginSigningService from "../../modules/marketplace-signing/service"
import { buildPublishingKeysDocument } from "../../modules/marketplace-signing/verify"

/**
 * One handler, two mounts (W3, docs/contracts/extension-manifest.md):
 *
 *  - GET /well-known/freeblackmarket-publishing-keys.json — the real route
 *    dir (src/api/well-known/...). A literal `.well-known` route DIRECTORY is
 *    a production trap: Medusa's route loader serves it in dev, but tsc's
 *    include glob skips dot-directories, so `medusa build` silently drops it
 *    from .medusa/server.
 *  - GET /.well-known/freeblackmarket-publishing-keys.json — the literal path
 *    the Blackout client pins (pluginSignature.ts), mounted from
 *    middlewares.ts as a terminating middleware (the /vendor/api-keys
 *    precedent).
 *
 * Serves the Ed25519 publishing keyset: `publicKey` is base64 SPKI DER (what
 * WebCrypto importKey("spki") needs); `publicKeyPem` rides along for parity
 * with /v1/marketplace/signing-keys. 503 while signing is unconfigured.
 */
export function servePublishingKeys(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve<PluginSigningService>(MARKETPLACE_SIGNING_MODULE)
  try {
    const { keyId, pem } = service.getPublicKeyPem()
    res.setHeader("cache-control", "public, max-age=300")
    return res.json(buildPublishingKeysDocument({ keyId, pem }))
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return res.status(503).json({ message, type: "signing_unavailable" })
  }
}
