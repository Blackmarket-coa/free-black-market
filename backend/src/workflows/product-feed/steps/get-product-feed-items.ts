import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { QueryContext } from "@medusajs/framework/utils"
import { CalculatedPriceSet } from "@medusajs/framework/types"

export type FeedItem = {
  id: string
  title: string
  description: string
  link: string
  image_link?: string
  additional_image_link?: string
  availability: string
  price: string
  sale_price?: string
  item_group_id: string
  condition?: string
  brand?: string
}

type StepInput = {
  currency_code: string
  country_code: string
}

const formatPrice = (price: number, currency_code: string) => {
  return `${new Intl.NumberFormat("en-US", {
    currency: currency_code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price)} ${currency_code.toUpperCase()}`
}

export const getProductFeedItemsStep = createStep(
  "get-product-feed-items",
  async (input: StepInput, { container }) => {
    const feedItems: FeedItem[] = []
    const query = container.resolve("query")
    const storefrontUrl = process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL || ""

    const limit = 100
    let offset = 0
    let count = 0
    const _countryCode = input.country_code.toLowerCase()
    const currencyCode = input.currency_code.toLowerCase()

    do {
      const {
        data: products,
        metadata
      } = await query.graph({
        entity: "product",
        fields: [
          "id",
          "title",
          "description",
          "handle",
          "thumbnail",
          "images.*",
          "status",
          "variants.*",
          "variants.calculated_price.*",
          "collection.*",
          "categories.*",
        ],
        filters: {
          status: "published",
        },
        context: {
          variants: {
            calculated_price: QueryContext({
              currency_code: currencyCode,
            }),
          }
        },
        pagination: {
          take: limit,
          skip: offset,
        }
      })

      count = metadata?.count ?? 0
      offset += limit

      for (const product of products) {
        if (!product.variants?.length) continue

        for (const variant of product.variants) {
          const calculatedPrice = (variant as any).calculated_price as CalculatedPriceSet
          if (!calculatedPrice?.calculated_amount) continue

          const hasOriginalPrice = calculatedPrice?.original_amount !== calculatedPrice?.calculated_amount
          const originalPrice = hasOriginalPrice ? calculatedPrice.original_amount : calculatedPrice.calculated_amount
          const salePrice = hasOriginalPrice ? calculatedPrice.calculated_amount : undefined

          // Check inventory status (inventory_quantity may be on variant if inventory is linked)
          const variantWithInventory = variant as typeof variant & { inventory_quantity?: number }
          const stockStatus = !variant.manage_inventory ? "in stock" :
            (variantWithInventory.inventory_quantity && variantWithInventory.inventory_quantity > 0) ? "in stock" : "out of stock"

          // Get brand from collection or default
          const brand = product.collection?.title || "Coalition Marketplace"

          feedItems.push({
            id: variant.id,
            title: product.title,
            description: product.description ?? "",
            link: `${storefrontUrl}/${input.country_code}/products/${product.handle}`,
            image_link: product.thumbnail ?? "",
            additional_image_link: product.images?.map((image: { url: string }) => image.url)?.join(","),
            availability: stockStatus,
            price: formatPrice(originalPrice as number, currencyCode),
            sale_price: salePrice ? formatPrice(salePrice as number, currencyCode) : undefined,
            item_group_id: product.id,
            condition: "new",
            brand,
          })
        }
      }
    } while (count > offset)

    return new StepResponse({ items: feedItems })
  }
)
