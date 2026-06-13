import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/product-created-sales-channel")
import {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Subscriber: Product Created → Link to Default Sales Channel
 *
 * When a product is created (by vendor or admin), automatically link it
 * to the store's default sales channel so it appears in the storefront.
 * Without this, products created outside the seed script are invisible
 * to the Store API because the publishable API key is scoped to a
 * specific sales channel.
 */
export default async function productCreatedSalesChannelHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const productId = data.id

  if (!productId) {
    return
  }

  try {
    const storeModuleService = container.resolve(Modules.STORE)
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Check if product is already linked to the store's default channel.
    // Products can have links to other channels and still be invisible in the
    // storefront if they miss the default channel associated with the
    // publishable API key.
    const [store] = await storeModuleService.listStores()
    const defaultSalesChannelId = store?.default_sales_channel_id

    if (!defaultSalesChannelId) {
      log.warn(
        `[productCreatedSalesChannel] No default sales channel configured for the store`
      )
      return
    }

    const { data: existingLinks } = await query.graph({
      entity: "product_sales_channel",
      fields: ["product_id", "sales_channel_id"],
      filters: { product_id: productId },
    })

    const alreadyLinkedToDefault =
      existingLinks?.some(
        (linkEntry: { sales_channel_id?: string }) =>
          linkEntry.sales_channel_id === defaultSalesChannelId
      ) ?? false

    if (alreadyLinkedToDefault) {
      return
    }

    await link.create({
      [Modules.PRODUCT]: {
        product_id: productId,
      },
      [Modules.SALES_CHANNEL]: {
        sales_channel_id: defaultSalesChannelId,
      },
    })
  } catch (error) {
    log.error(
      `[productCreatedSalesChannel] Failed to link product ${productId} to default sales channel:`,
      error
    )
  }
}

export const config: SubscriberConfig = {
  event: "product.created",
}
