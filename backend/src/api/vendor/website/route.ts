import { createLogger } from "../../../shared/logger";
const log = createLogger("api/vendor/website");
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { requireSellerId } from "../../../shared";
import {
  createSellerMetadataRecord,
  updateSellerMetadataRecord,
} from "../../../modules/seller-extension/metadata-service";
import {
  isProvisioningStale,
  normalizeDomains,
  probeSiteLive,
} from "../../../shared/site-provisioning";
import { serializeWebsite } from "../../../shared/website-config";

type SellerRow = { id: string; handle: string };
type MetaRow = {
  id: string;
  connect_domains: string[] | null;
  site_status: string | null;
  site_url: string | null;
  site_repo: string | null;
  updated_at?: string | Date | null;
};

async function loadContext(req: AuthenticatedMedusaRequest, sellerId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "handle"],
    filters: { id: sellerId },
  });
  const seller = sellers?.[0] as SellerRow | undefined;

  const { data: metaRows } = await query.graph({
    entity: "seller_metadata",
    fields: [
      "id",
      "connect_domains",
      "site_status",
      "site_url",
      "site_repo",
      "updated_at",
    ],
    filters: { seller_id: sellerId },
  });
  const meta = (metaRows?.[0] as MetaRow | undefined) || null;

  return { seller, meta };
}

/**
 * GET /vendor/website
 *
 * Returns the vendor's "My Website" configuration: the ready-to-paste Connect
 * snippet, the whitelisted domains, and the Launch status.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const sellerId = await requireSellerId(req, res);
  if (!sellerId) return;

  try {
    const { seller, meta } = await loadContext(req, sellerId);
    if (!seller) {
      return res
        .status(404)
        .json({ message: "Seller not found", type: "not_found" });
    }

    // Self-healing promote: while a launched site is provisioning, probe it and
    // flip to "live" the moment it answers. Bounded + awaited so the response
    // reflects the new status immediately (the panel polls this endpoint). This
    // is the always-on fallback for the optional /webhooks/site-deploy callback.
    // If it stays stuck past PROVISIONING_TIMEOUT_MS without ever answering,
    // flip it to "failed" so the panel stops spinning and the vendor can retry.
    let effectiveMeta = meta;
    if (meta?.site_status === "provisioning") {
      const live = meta.site_url ? await probeSiteLive(meta.site_url) : false;
      if (live) {
        const sellerExtension = req.scope.resolve("sellerExtension");
        await updateSellerMetadataRecord(sellerExtension as any, [
          { id: meta.id, site_status: "live" },
        ]);
        effectiveMeta = { ...meta, site_status: "live" };
      } else if (isProvisioningStale(meta.updated_at)) {
        const sellerExtension = req.scope.resolve("sellerExtension");
        await updateSellerMetadataRecord(sellerExtension as any, [
          { id: meta.id, site_status: "failed" },
        ]);
        effectiveMeta = { ...meta, site_status: "failed" };
      }
    }

    return res.json({
      website: serializeWebsite(seller.handle, effectiveMeta),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    log.error("[GET /vendor/website] failed:", msg);
    return res.status(500).json({
      message: "Failed to load website settings",
      type: "server_error",
    });
  }
}

/**
 * POST /vendor/website
 *
 * Save the Connect whitelist (bare hostnames). Body is validated upstream:
 *   { connect_domains: string[] | null }
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) {
  const sellerId = await requireSellerId(req, res);
  if (!sellerId) return;

  try {
    const body = req.body as { connect_domains?: string[] | null };
    const domains = normalizeDomains(body.connect_domains ?? []);

    const { seller, meta } = await loadContext(req, sellerId);
    if (!seller) {
      return res
        .status(404)
        .json({ message: "Seller not found", type: "not_found" });
    }

    const sellerExtension = req.scope.resolve("sellerExtension");
    if (meta) {
      await updateSellerMetadataRecord(sellerExtension as any, [
        { id: meta.id, connect_domains: domains },
      ]);
    } else {
      await createSellerMetadataRecord(sellerExtension as any, [
        { seller_id: sellerId, connect_domains: domains },
      ]);
    }

    // Re-read so the response reflects persisted state.
    const refreshed = await loadContext(req, sellerId);
    return res.json({
      website: serializeWebsite(seller.handle, refreshed.meta),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    log.error("[POST /vendor/website] failed:", msg);
    return res.status(500).json({
      message: "Failed to save website settings",
      type: "server_error",
    });
  }
}
