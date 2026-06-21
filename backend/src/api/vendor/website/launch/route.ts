import { createLogger } from "../../../../shared/logger";
const log = createLogger("api/vendor/website/launch");
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { requireSellerId } from "../../../../shared";
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../../modules/seller-extension/metadata-service";
import {
  isLaunchConfigured,
  provisionSite,
} from "../../../../shared/site-provisioning";
import { serializeWebsite } from "../../../../shared/website-config";

type MetaRow = {
  id: string;
  connect_domains: string[] | null;
  site_status: string | null;
  site_url: string | null;
  site_repo: string | null;
};

/**
 * POST /vendor/website/launch
 *
 * Provision a standardized FBM-hosted site for the vendor (Mode 2 — Launch).
 * Creates a repo from the GitHub template and kicks its configure workflow,
 * then records the provisioning state on seller_metadata.
 *
 * Degrades gracefully: returns 501 when the Launch flow isn't configured for
 * this deployment (no GitHub token/org/template), so the panel can keep the
 * button disabled with an explanation rather than erroring.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const sellerId = await requireSellerId(req, res);
  if (!sellerId) return;

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const sellerExtension = req.scope.resolve("sellerExtension");

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "handle"],
    filters: { id: sellerId },
  });
  const seller = sellers?.[0] as { id: string; handle: string } | undefined;
  if (!seller?.handle) {
    return res
      .status(404)
      .json({ message: "Seller not found", type: "not_found" });
  }

  if (!isLaunchConfigured()) {
    return res.status(501).json({
      message:
        "Site Launch isn't enabled on this deployment. You can still use Connect to embed your store on an existing site.",
      type: "not_implemented",
    });
  }

  const body = (req.body || {}) as { subdomain?: string };
  const subdomain = (body.subdomain || seller.handle)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");

  const { data: metaRows } = await query.graph({
    entity: "seller_metadata",
    fields: ["id", "connect_domains", "site_status", "site_url", "site_repo"],
    filters: { seller_id: sellerId },
  });

  // Resolve the metadata row id exactly once (creating it if absent) so every
  // subsequent write is an idempotent update — never a second insert, which
  // would violate the unique seller_id constraint.
  let metaId = (metaRows?.[0] as MetaRow | undefined)?.id;
  if (!metaId) {
    const created = (await createSellerMetadataRecord(sellerExtension as any, [
      { seller_id: sellerId, site_status: "provisioning" },
    ])) as Array<{ id: string }> | { id: string };
    metaId = Array.isArray(created) ? created[0]?.id : created?.id;
  }

  const persist = async (fields: Record<string, unknown>) => {
    if (!metaId) return;
    await updateSellerMetadataRecord(sellerExtension as any, [
      { id: metaId, ...fields },
    ]);
  };

  try {
    await persist({ site_status: "provisioning" });

    const result = await provisionSite({ handle: seller.handle, subdomain });

    await persist({
      site_status: "provisioning",
      site_url: result.url,
      site_repo: result.repo,
    });

    const { data: refreshed } = await query.graph({
      entity: "seller_metadata",
      fields: ["connect_domains", "site_status", "site_url", "site_repo"],
      filters: { seller_id: sellerId },
    });

    return res.status(202).json({
      launched: true,
      website: serializeWebsite(
        seller.handle,
        (refreshed?.[0] as MetaRow) || null,
      ),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    log.error(
      `[POST /vendor/website/launch] failed for ${seller.handle}:`,
      msg,
    );
    await persist({ site_status: "failed" }).catch(() => {});
    return res.status(502).json({
      message: "Site provisioning failed. Please try again in a moment.",
      type: "provisioning_error",
    });
  }
}
