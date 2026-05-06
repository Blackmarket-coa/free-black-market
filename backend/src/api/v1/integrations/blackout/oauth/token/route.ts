import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  issueBlackoutToken,
  verifyBlackoutCredentials,
  isBlackoutIntegrationEnabled,
} from "../../../../../../lib/blackout-oauth"

type Body = {
  client_id?: string
  client_secret?: string
  grant_type?: string
}

/**
 * OAuth client-credentials token endpoint for Blackout integration reads.
 * Returns a short-lived JWT (HS256, signed with JWT_SECRET) with
 * iss=fbm, aud=blackout. Token is required by the Bearer middleware on
 * other /v1/integrations/blackout/* routes when FBM_BLACKOUT_INTEGRATION=1.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  if (!isBlackoutIntegrationEnabled()) {
    return res
      .status(503)
      .json({ message: "Blackout integration is disabled (FBM_BLACKOUT_INTEGRATION!=1)" })
  }

  // Accept both JSON and form-encoded bodies (OAuth convention).
  const body = (req.validatedBody || req.body || {}) as Body
  const clientId = body.client_id || (req.query.client_id as string | undefined)
  const clientSecret = body.client_secret || (req.query.client_secret as string | undefined)
  const grantType = body.grant_type || (req.query.grant_type as string | undefined)

  if (grantType && grantType !== "client_credentials") {
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only client_credentials is supported",
    })
  }

  if (!clientId || !clientSecret) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "client_id and client_secret are required",
    })
  }

  if (!verifyBlackoutCredentials(clientId, clientSecret)) {
    return res.status(401).json({
      error: "invalid_client",
      error_description: "Invalid client credentials",
    })
  }

  const ttlSeconds = Number(process.env.FBM_BLACKOUT_TOKEN_TTL_SECONDS || 3600)
  const accessToken = issueBlackoutToken(clientId, ttlSeconds)

  return res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ttlSeconds,
  })
}
