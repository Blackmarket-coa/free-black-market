import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { NURSERY_VERTICAL_MODULE } from "../../../modules/nursery-vertical"
import { NurseryListingSubtype } from "../../../modules/nursery-vertical/models"
import type NurseryVerticalModuleService from "../../../modules/nursery-vertical/service"
import { forbidden } from "../../../shared/community-read-access"
import { definedFields } from "../../../shared/defined-fields"
import { productSellerIds } from "../../../shared/product-sellers"
import { recordId } from "../../../shared/route-input"

/**
 * Which nursery attribute rows a store may write and read (SD-158).
 *
 * An attribute row extends one product (`product_id` is unique on the table)
 * and carries the store that wrote it (`seller_id`). Before SD-158 the POST
 * found the row by the body's `product_id` alone and spread the body,
 * `seller_id` included, into the write. Measured on Postgres: store B's member
 * posted store A's product with `seller_id` set to B and got 201 on A's row,
 * whose `cost_to_produce` came back in the answer, whose `seller_id` became B
 * and whose `hardiness_zone` was overwritten; B could also create a row for
 * another of A's products.
 *
 * A row is the store's when its `seller_id` is the store AND its product is
 * the store's, by Mercur's seller-product link (`seller_product`, the only
 * record of who owns a product). Both halves are needed: the first alone
 * would leave B the rows it wrote on A's products before this fix. A row
 * that is missing, another store's, or on a product the store does not own
 * gets `forbidden()`: 403 for each, so the status says nothing about which
 * ids exist.
 */

type Res = Pick<MedusaResponse, "status">

/** The columns a store writes; never `id`, `seller_id`, `product_id` or `metadata`. */
const attributeFields = {
  subtype: z.nativeEnum(NurseryListingSubtype),
  edible_use: z.array(z.string()).nullable().optional(),
  medicinal_use: z.array(z.string()).nullable().optional(),
  hardiness_zone: z.string().nullable().optional(),
  propagation_method: z.string().nullable().optional(),
  channel_fit: z.array(z.string()).nullable().optional(),
  cost_to_produce: z.number().nullable().optional(),
  tag_data: z.record(z.string(), z.unknown()).nullable().optional(),
}

/**
 * POST /vendor/nursery/products. Keys outside the list are dropped, so a
 * `seller_id` in the body is never read; the store is the vendor gate's.
 */
export const upsertAttributeBody = z.object({ product_id: recordId, ...attributeFields })

/** PUT /vendor/nursery/products/:id: a partial update of the same columns. */
export const updateAttributeBody = z.object(attributeFields).partial()

export const attributePath = z.object({ id: recordId })

export type AttributeFields = Partial<z.output<typeof updateAttributeBody>>

type AttributeRow = { id: string; seller_id: string; product_id: string }

/**
 * What a row is reset to when the product's owner takes it over: every
 * column it writes, empty. Nothing another store wrote survives the takeover.
 */
const EMPTY_ROW = {
  edible_use: null,
  medicinal_use: null,
  hardiness_zone: null,
  propagation_method: null,
  channel_fit: null,
  cost_to_produce: null,
  tag_data: null,
  metadata: null,
}

export function nurseryService(req: MedusaRequest): NurseryVerticalModuleService {
  return req.scope.resolve<NurseryVerticalModuleService>(NURSERY_VERTICAL_MODULE)
}

/** Whether the store owns the product, by its `seller_product` link. */
export async function storeOwnsProduct(req: MedusaRequest, sellerId: string, productId: string): Promise<boolean> {
  return (await productSellerIds(req.scope, [productId])).get(productId) === sellerId
}

/**
 * The rows among `rows` whose product the store owns. A row the store wrote
 * on another store's product before SD-158 is not the store's to read.
 */
export async function onStoreProducts<T extends { product_id: string }>(
  req: MedusaRequest,
  sellerId: string,
  rows: T[]
): Promise<T[]> {
  const owners = await productSellerIds(
    req.scope,
    rows.map((row) => row.product_id)
  )
  return rows.filter((row) => owners.get(row.product_id) === sellerId)
}

/** The store's attribute row, or `forbidden()` (null) for any other. */
export async function ownedAttribute(
  req: MedusaRequest,
  res: Res,
  sellerId: string,
  id: string
): Promise<AttributeRow | null> {
  const [row] = (await nurseryService(req).listNurseryProductAttributes({ id }, { take: 1 })) as AttributeRow[]
  if (!row || row.seller_id !== sellerId || !(await storeOwnsProduct(req, sellerId, row.product_id))) {
    forbidden(res)
    return null
  }
  return row
}

type WriteInput = Parameters<NurseryVerticalModuleService["updateNurseryProductAttributes"]>[0]
type CreateInput = Parameters<NurseryVerticalModuleService["createNurseryProductAttributes"]>[0]

/**
 * A parsed write, as the generated service methods type it. The model
 * declares `edible_use`, `medicinal_use` and `channel_fit` as `model.json()`,
 * which Medusa types as an object, while the columns hold the arrays of tags
 * the panel sends (and always have); the values themselves are the parsed
 * ones above.
 */
export function asAttributeUpdate(values: Record<string, unknown>): WriteInput {
  return values as unknown as WriteInput
}

function asAttributeCreate(values: Record<string, unknown>): CreateInput {
  return values as unknown as CreateInput
}

/**
 * Write the store's attribute row for a product it owns: create it, update it
 * with the fields sent, or take over a row another store wrote.
 *
 * The caller must already have checked that the store owns the product
 * (`storeOwnsProduct`). The row the product has is matched by store and
 * product: the store's own row is updated with the fields sent and nothing
 * else. Because `product_id` is unique, a row another store wrote on the
 * product before SD-158 cannot be ignored on write (a create would fail on the
 * constraint and leave the owner unable to describe its own product), so the
 * owner's write takes it over: `seller_id` becomes the owner and every other
 * column is reset to what was sent, empty otherwise, which is how bookings
 * resolve the same case (`saveConfigAsProductOwner`, SD-83).
 * `previousSellerId` names that other store, or is null.
 */
export async function saveAttributeAsProductOwner(
  service: NurseryVerticalModuleService,
  sellerId: string,
  productId: string,
  fields: AttributeFields
): Promise<{ attribute: unknown; previousSellerId: string | null }> {
  const given = definedFields(fields)
  const [existing] = (await service.listNurseryProductAttributes({ product_id: productId }, { take: 1 })) as AttributeRow[]
  if (!existing) {
    const attribute = await service.createNurseryProductAttributes(
      asAttributeCreate({ ...given, seller_id: sellerId, product_id: productId })
    )
    return { attribute, previousSellerId: null }
  }
  if (existing.seller_id === sellerId) {
    await service.updateNurseryProductAttributes(asAttributeUpdate({ ...given, id: existing.id }))
  } else {
    await service.updateNurseryProductAttributes(
      asAttributeUpdate({ ...EMPTY_ROW, ...given, id: existing.id, seller_id: sellerId })
    )
  }
  return {
    attribute: await service.retrieveNurseryProductAttribute(existing.id),
    previousSellerId: existing.seller_id === sellerId ? null : existing.seller_id,
  }
}
