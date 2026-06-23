import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../middlewares/seller-context-v1"
import { MARKETPLACE_LISTING_MODULE } from "../../../../modules/marketplace-listing"
import type MarketplaceListingService from "../../../../modules/marketplace-listing/service"

const slugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
const semverRegex = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i
const httpsUrl = z.string().url().refine((u) => /^https:\/\//.test(u), {
  message: "url must use https://",
})

const AssetSchema = z.object({
  path: z.string().min(1).max(256),
  url: httpsUrl,
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
})

const CreateListingSchema = z.object({
  slug: z.string().regex(slugRegex),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
  manifest: z.record(z.string(), z.unknown()),
  code_blob_url: httpsUrl.nullish(),
  code_blob_sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullish(),
  assets: z.array(AssetSchema).max(64).nullish(),
  version: z.string().regex(semverRegex),
  embed_origins: z.array(httpsUrl).max(16).nullish(),
})

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = CreateListingSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid listing payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }

  const service = req.scope.resolve<MarketplaceListingService>(
    MARKETPLACE_LISTING_MODULE
  )

  const existing = await service.listCreatorListings({
    seller_id: sellerId,
    slug: parsed.data.slug,
  })
  if (existing.length > 0) {
    return res.status(409).json({
      message: "A listing with that slug already exists for this seller",
      type: "duplicate_slug",
    })
  }

  const listing = await (
    service as unknown as {
      createCreatorListings(data: Record<string, unknown>): Promise<unknown>
    }
  ).createCreatorListings({
    seller_id: sellerId,
    slug: parsed.data.slug,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    manifest: parsed.data.manifest,
    code_blob_url: parsed.data.code_blob_url ?? null,
    code_blob_sha256: parsed.data.code_blob_sha256 ?? null,
    assets: parsed.data.assets ?? null,
    version: parsed.data.version,
    embed_origins: parsed.data.embed_origins ?? null,
  })

  return res.status(201).json({ listing })
}
