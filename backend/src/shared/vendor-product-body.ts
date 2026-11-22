import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import sellerInventoryItemLink from "@mercurjs/b2c-core/links/seller-inventory-item"
import sellerShippingProfileLink from "@mercurjs/b2c-core/links/seller-shipping-profile"

/**
 * The records a vendor's product-create body may name that belong to a store:
 * a shipping profile and, per variant, inventory items. Each must be the
 * caller's own.
 *
 * Both vendor create routes pass the body to `createProductsWorkflow`.
 * `/vendor/seller-products` validates nothing, so a `shipping_profile_id`
 * naming another store's profile was linked to the product (measured on
 * Postgres: 200, the product the caller's alone, its shipping profile the
 * other store's default, published), and Mercur's hook, which assigns the
 * store's default profile, returns early when a link exists. The other store
 * then cannot delete that profile, and the product matches its shipping
 * options. Mercur's validator in front of `POST /vendor/products` refuses
 * `shipping_profile_id` but accepts `variants[].inventory_items`.
 *
 * A profile the caller owns is kept, not dropped: a vendor may have more
 * than one (Mercur's vendor shipping-profile routes create them), and a
 * refusal tells a client its choice was not applied where dropping it would
 * not. Everything else a create body can name (sales channels, categories,
 * collection, type, tags) is a marketplace-wide record, not a store's.
 *
 * The routes answer a refusal with `forbidden()` (403), the same for an id
 * that names nothing and one of another store, so the answer says nothing
 * about other stores' records; the messages below are what they log.
 *
 * Inventory items: Medusa only checks that a named item exists, so a variant
 * could be made to require another store's item, and so move that store's
 * stock (through POS, for one), or claim an item no store is linked to yet
 * (ticket products make those) and lock its owner out (measured by the
 * stock-guard review). Only items linked to the caller's store, by a live
 * `seller_inventory_item` link, are accepted.
 */

export const SHIPPING_PROFILE_NOT_YOURS =
  "shipping_profile_id must be one of your store's shipping profiles."
export const INVENTORY_ITEM_NOT_YOURS =
  "variants[].inventory_items may only name your store's inventory items."

type Query = {
  graph: (args: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> }>
}

const isAbsent = (value: unknown) => value === undefined || value === null || value === ""

/**
 * Checks `productData` (a create body without `additional_data`) and drops
 * an empty `shipping_profile_id`, which the panel's form can send and the
 * workflow would reject. Returns the refusal message, or null when the body
 * names only the caller's records.
 */
export async function refuseOtherStoresRecords(
  scope: MedusaContainer,
  sellerId: string,
  productData: Record<string, unknown>
): Promise<string | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as Query

  if ("shipping_profile_id" in productData) {
    const profileId = productData.shipping_profile_id
    if (isAbsent(profileId)) {
      delete productData.shipping_profile_id
    } else {
      if (typeof profileId !== "string") return SHIPPING_PROFILE_NOT_YOURS
      const { data } = await query.graph({
        entity: sellerShippingProfileLink.entryPoint,
        fields: ["shipping_profile_id"],
        filters: { seller_id: sellerId, shipping_profile_id: profileId },
      })
      if (!data.length) return SHIPPING_PROFILE_NOT_YOURS
    }
  }

  const variants = Array.isArray(productData.variants) ? productData.variants : []
  const named: string[] = []
  for (const variant of variants) {
    const items = (variant as { inventory_items?: unknown } | null)?.inventory_items
    if (items === undefined || items === null) continue
    if (!Array.isArray(items)) return INVENTORY_ITEM_NOT_YOURS
    for (const item of items) {
      const id = (item as { inventory_item_id?: unknown } | null)?.inventory_item_id
      if (typeof id !== "string" || !id) return INVENTORY_ITEM_NOT_YOURS
      named.push(id)
    }
  }
  if (named.length) {
    const ids = [...new Set(named)]
    const { data } = await query.graph({
      entity: sellerInventoryItemLink.entryPoint,
      fields: ["inventory_item_id"],
      filters: { seller_id: sellerId, inventory_item_id: ids },
    })
    const owned = new Set(data.map((row) => String(row.inventory_item_id)))
    if (ids.some((id) => !owned.has(id))) return INVENTORY_ITEM_NOT_YOURS
  }

  return null
}
