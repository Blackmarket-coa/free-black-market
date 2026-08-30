import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../shared/logger"
import { REVIEWS_MODULE } from "../../../modules/reviews"
import type ReviewsService from "../../../modules/reviews/service"
import { ReviewSubjectType } from "../../../modules/reviews/models/product-review"
import { updateSellerMetadataRecord } from "../../../modules/seller-extension/metadata-service"
import type SellerExtensionService from "../../../modules/seller-extension/service"

const log = createLogger("api/store/reviews")

/** "Jordan Rivera" → "Jordan R."  (privacy-safe public display name) */
function displayName(
  first?: string | null,
  last?: string | null
): string | null {
  const f = (first || "").trim()
  const l = (last || "").trim()
  if (!f && !l) return null
  return l ? `${f} ${l[0]}.`.trim() : f
}

function requireCustomer(req: MedusaRequest, res: MedusaResponse): string | null {
  const authContext = (req as any).auth_context as
    | { actor_id?: string; actor_type?: string }
    | undefined
  const customerId = authContext?.actor_id
  if (!customerId || !customerId.startsWith("cus_")) {
    res
      .status(401)
      .json({ message: "Customer authentication required", type: "unauthorized" })
    return null
  }
  return customerId
}

/**
 * The write body, in either accepted dialect (W4 reviews dedupe):
 *
 *   FBM:        { order_id, product_id, rating, title?, body? }
 *   storefront: { order_id, rating, reference: "product"|"seller",
 *                 reference_id, customer_note }
 *
 * The storefront dialect predates the dedupe — its ReviewForm posts
 * seller-subject reviews here — and used to hit a plugin whose handler this
 * route now overrides, so both dialects land in the one reviews module.
 */
function normalizeBody(raw: Record<string, unknown>): {
  order_id: string
  rating: number
  subject: ReviewSubjectType
  product_id: string | null
  seller_ref: string | null
  title: string | null
  body: string | null
} | null {
  const order_id = String(raw.order_id || "")
  const rating = Math.round(Number(raw.rating))
  const note =
    typeof raw.body === "string"
      ? raw.body
      : typeof raw.customer_note === "string"
        ? raw.customer_note
        : null
  const title = typeof raw.title === "string" ? raw.title : null

  if (raw.product_id) {
    return {
      order_id,
      rating,
      subject: ReviewSubjectType.PRODUCT,
      product_id: String(raw.product_id),
      seller_ref: null,
      title,
      body: note,
    }
  }
  const reference = typeof raw.reference === "string" ? raw.reference : null
  const referenceId = raw.reference_id ? String(raw.reference_id) : null
  if (reference === "product" && referenceId) {
    return {
      order_id,
      rating,
      subject: ReviewSubjectType.PRODUCT,
      product_id: referenceId,
      seller_ref: null,
      title,
      body: note,
    }
  }
  if (reference === "seller" && referenceId) {
    return {
      order_id,
      rating,
      subject: ReviewSubjectType.SELLER,
      product_id: null,
      seller_ref: referenceId,
      title,
      body: note,
    }
  }
  return null
}

async function recomputeSellerRating(
  req: MedusaRequest,
  reviews: ReviewsService,
  sellerId: string
): Promise<void> {
  try {
    const query = req.scope.resolve("query")
    const aggregate = await reviews.getSellerAggregate(sellerId)
    const { data: metaRows } = await query.graph({
      entity: "seller_metadata",
      fields: ["id"],
      filters: { seller_id: sellerId } as any,
    })
    const metaId = metaRows?.[0]?.id
    if (metaId) {
      const sellerExtension = req.scope.resolve(
        "sellerExtension"
      ) as SellerExtensionService
      await updateSellerMetadataRecord(sellerExtension, [
        { id: metaId, rating: aggregate.average, review_count: aggregate.count },
      ])
    }
  } catch (err) {
    log.warn(`rating recompute failed for seller ${sellerId}`, err)
  }
}

/**
 * POST /store/reviews  (authenticated customer)
 *
 * Creates a verified review — of a product in the order, or of the order's
 * seller — accepted only when the referenced order belongs to the
 * authenticated customer (and, for products, actually contains the product;
 * for sellers, was actually sold by that seller). Recomputes the seller's
 * denormalized rating/review_count afterward.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = requireCustomer(req, res)
  if (!customerId) return

  const parsed = normalizeBody((req.body ?? {}) as Record<string, unknown>)
  if (!parsed || !parsed.order_id) {
    return res.status(400).json({
      message:
        "order_id plus either product_id or reference/reference_id are required",
      type: "invalid_data",
    })
  }
  if (
    !Number.isInteger(parsed.rating) ||
    parsed.rating < 1 ||
    parsed.rating > 5
  ) {
    return res
      .status(400)
      .json({ message: "rating must be an integer 1-5", type: "invalid_data" })
  }

  try {
    const query = req.scope.resolve("query")

    // 1) The order must belong to this customer.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "customer_id", "items.product_id"],
      filters: { id: parsed.order_id } as any,
    })
    const order = orders?.[0]
    if (!order || order.customer_id !== customerId) {
      return res
        .status(403)
        .json({ message: "Order does not belong to you", type: "not_allowed" })
    }
    const productIds: string[] = (order.items || [])
      .map((i: any) => i.product_id)
      .filter(Boolean)

    // 2) Resolve the reviewed seller from the order's contents.
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "seller.id"],
      filters: { id: productIds } as any,
    })
    const sellerByProduct = new Map<string, string>()
    for (const p of products ?? []) {
      const sid = (p as any)?.seller?.id
      if (sid) sellerByProduct.set(String((p as any).id), String(sid))
    }

    let sellerId: string | null = null
    if (parsed.subject === ReviewSubjectType.PRODUCT) {
      if (!productIds.includes(parsed.product_id!)) {
        return res.status(400).json({
          message: "Product was not part of this order",
          type: "invalid_data",
        })
      }
      sellerId = sellerByProduct.get(parsed.product_id!) ?? null
      if (!sellerId) {
        return res
          .status(404)
          .json({ message: "Product seller not found", type: "not_found" })
      }
    } else {
      const orderSellerIds = new Set(sellerByProduct.values())
      if (!parsed.seller_ref || !orderSellerIds.has(parsed.seller_ref)) {
        return res.status(400).json({
          message: "Seller did not sell anything in this order",
          type: "invalid_data",
        })
      }
      sellerId = parsed.seller_ref
    }

    // 3) Privacy-safe display name from the customer record.
    let author: string | null = null
    try {
      const { data: customers } = await query.graph({
        entity: "customer",
        fields: ["first_name", "last_name"],
        filters: { id: customerId } as any,
      })
      author = displayName(customers?.[0]?.first_name, customers?.[0]?.last_name)
    } catch {
      /* non-fatal */
    }

    const reviews = req.scope.resolve(REVIEWS_MODULE) as ReviewsService

    // One review per (order, subject) — guard before hitting the unique idx.
    const existing = await reviews.listProductReviews(
      parsed.subject === ReviewSubjectType.PRODUCT
        ? { order_id: parsed.order_id, product_id: parsed.product_id }
        : {
            order_id: parsed.order_id,
            seller_id: sellerId,
            subject_type: ReviewSubjectType.SELLER,
          },
      { take: 1 }
    )
    if (existing?.length) {
      return res.status(409).json({
        message:
          parsed.subject === ReviewSubjectType.PRODUCT
            ? "You already reviewed this product for this order"
            : "You already reviewed this seller for this order",
        type: "conflict",
      })
    }

    const created = await reviews.createProductReviews({
      subject_type: parsed.subject,
      product_id: parsed.product_id,
      seller_id: sellerId,
      order_id: parsed.order_id,
      customer_id: customerId,
      rating: parsed.rating,
      title: parsed.title?.slice(0, 120) ?? null,
      body: parsed.body?.slice(0, 4000) ?? null,
      customer_display_name: author,
      is_verified: true,
    })

    // 4) Recompute the seller's denormalized rating/review_count.
    await recomputeSellerRating(req, reviews, sellerId)

    return res.status(201).json({
      review: {
        id: created.id,
        reference: parsed.subject,
        product_id: parsed.product_id,
        seller_id: sellerId,
        rating: parsed.rating,
        title: created.title ?? null,
        body: created.body ?? null,
        customer_note: created.body ?? null,
        author: created.customer_display_name ?? "Verified buyer",
        verified: true,
        created_at: created.created_at,
      },
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /store/reviews] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to submit review", type: "server_error" })
  }
}

/**
 * GET /store/reviews  (authenticated customer)
 *
 * The customer's own reviews, newest first, with a light seller join —
 * the shape the storefront's "written reviews" page renders. Overrides the
 * legacy plugin listing at this path so reads come from the same module
 * writes land in.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = requireCustomer(req, res)
  if (!customerId) return

  try {
    const reviews = req.scope.resolve(REVIEWS_MODULE) as ReviewsService
    const rows = await reviews.listProductReviews(
      { customer_id: customerId },
      { take: 200, order: { created_at: "DESC" } }
    )

    const sellerIds = [...new Set(rows.map((r) => String(r.seller_id)))]
    const sellers = new Map<string, { id: string; name: string; photo: string | null }>()
    if (sellerIds.length) {
      try {
        const query = req.scope.resolve("query")
        const { data } = await query.graph({
          entity: "seller",
          fields: ["id", "name", "photo"],
          filters: { id: sellerIds } as any,
        })
        for (const s of data ?? []) {
          sellers.set(String((s as any).id), {
            id: String((s as any).id),
            name: (s as any).name ?? "",
            photo: (s as any).photo ?? null,
          })
        }
      } catch {
        /* seller join is presentational — reviews still return */
      }
    }

    return res.json({
      reviews: rows.map((r) => ({
        id: r.id,
        reference: r.subject_type ?? "product",
        rating: Number(r.rating),
        customer_note: r.body ?? "",
        title: r.title ?? null,
        order_id: r.order_id ?? null,
        product_id: r.product_id ?? null,
        seller: sellers.get(String(r.seller_id)) ?? {
          id: String(r.seller_id),
          name: "",
          photo: null,
        },
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /store/reviews] failed:", msg)
    return res
      .status(500)
      .json({ message: "Failed to list reviews", type: "server_error" })
  }
}
