import { createLogger } from "../../../shared/logger";
const log = createLogger("api/webhooks/site-deploy");
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateSellerMetadataRecord } from "../../../modules/seller-extension/metadata-service";
import {
  isDeployCallbackConfigured,
  verifyDeploySignature,
} from "../../../shared/site-provisioning";

/**
 * POST /webhooks/site-deploy
 *
 * Inbound callback from a launched FBM site's GitHub Actions deploy. Flips the
 * vendor's `seller_metadata.site_status` from "provisioning" to "live" (or
 * "failed") in real time once the static site is published.
 *
 * Public + unauthenticated: authenticity is established by an HMAC-SHA256
 * signature over the raw body (header `x-fbm-signature`, secret
 * SITE_DEPLOY_SECRET). Gated on that secret — returns 501 when unconfigured,
 * mirroring how Launch itself degrades. The liveness probe in
 * GET /vendor/website is the always-on fallback when this isn't wired.
 */
export const AUTHENTICATE = false;

type Body = { repo?: string; url?: string; status?: "live" | "failed" };

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!isDeployCallbackConfigured()) {
    return res.status(501).json({
      message: "Deploy callback not configured",
      type: "not_implemented",
    });
  }

  const signature = String(req.headers["x-fbm-signature"] || "");
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const payload =
    rawBody && Buffer.isBuffer(rawBody)
      ? rawBody
      : JSON.stringify(req.body ?? {});

  if (!verifyDeploySignature(payload, signature)) {
    return res
      .status(401)
      .json({ message: "Invalid signature", type: "unauthorized" });
  }

  const body = (req.body || {}) as Body;
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const status = body.status === "failed" ? "failed" : "live";

  if (!repo) {
    return res
      .status(400)
      .json({ message: "repo is required", type: "invalid_data" });
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: rows } = await query.graph({
      entity: "seller_metadata",
      fields: ["id", "site_status"],
      filters: { site_repo: repo } as Record<string, unknown>,
    });
    const row = rows?.[0] as { id: string } | undefined;

    if (row) {
      const sellerExtension =
        req.scope.resolve<Parameters<typeof updateSellerMetadataRecord>[0]>(
          "sellerExtension"
        );
      await updateSellerMetadataRecord(sellerExtension, [
        { id: row.id, site_status: status, ...(url ? { site_url: url } : {}) },
      ]);
      log.info(`site-deploy callback: ${repo} -> ${status}`);
    } else {
      // Signed correctly but no matching site — don't reveal that to the caller.
      log.warn(`site-deploy callback for unknown repo: ${repo}`);
    }

    // Always 200 once authenticated, regardless of whether a row matched.
    return res.status(200).json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    log.error(`site-deploy callback failed for ${repo}:`, msg);
    return res
      .status(500)
      .json({ message: "Failed to update site status", type: "server_error" });
  }
}
