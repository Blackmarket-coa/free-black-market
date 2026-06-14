import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * This loader ensures the default sales channel exists and is properly
 * linked on every backend startup.
 *
 * Without a default sales channel:
 * - The product-created subscriber cannot auto-link new products
 * - Products are invisible in the Store API (scoped by publishable API key)
 * - The storefront shows no products
 *
 * This loader:
 * 1. Creates "Default Sales Channel" if it doesn't exist
 * 2. Sets it as the store's default_sales_channel_id if not already set
 * 3. Links any orphaned products (products with no sales channel) to the default channel
 */
export default async function initSalesChannels(
  container: MedusaContainer
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
    const storeService = container.resolve(Modules.STORE)
    const productService = container.resolve(Modules.PRODUCT)
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // 1. Ensure Default Sales Channel exists
    const channels = await salesChannelService.listSalesChannels({
      name: "Default Sales Channel",
    })

    let defaultChannel = channels[0]

    if (!defaultChannel) {
      logger.info("Creating Default Sales Channel...")
      const created = await salesChannelService.createSalesChannels({
        name: "Default Sales Channel",
      })
      defaultChannel = Array.isArray(created) ? created[0] : created
      logger.info(
        `Created Default Sales Channel: ${defaultChannel.id}`
      )
    }

    // 2. Ensure the store points to this channel
    const [store] = await storeService.listStores()

    if (!store) {
      logger.info("No store found. Skipping sales channel linking.")
      return
    }

    if (store.default_sales_channel_id !== defaultChannel.id) {
      await storeService.updateStores(store.id, {
        default_sales_channel_id: defaultChannel.id,
      })
      logger.info(
        `Linked Default Sales Channel ${defaultChannel.id} to store ${store.id}`
      )
    }

    // 3. Link orphaned products to the default sales channel
    const products = await productService.listProducts(
      {},
      { select: ["id", "title"], take: null }
    )

    if (!products || products.length === 0) {
      logger.info("No products found. Sales channel sync complete.")
      return
    }

    let linked = 0

    for (const product of products) {
      try {
        const { data: existingLinks } = await query.graph({
          entity: "product_sales_channel",
          fields: ["product_id", "sales_channel_id"],
          filters: { product_id: product.id },
        })

        const alreadyLinkedToDefault =
          existingLinks?.some(
            (linkEntry: { sales_channel_id?: string }) =>
              linkEntry.sales_channel_id === defaultChannel.id
          ) ?? false

        if (alreadyLinkedToDefault) {
          continue
        }

        await link.create({
          [Modules.PRODUCT]: {
            product_id: product.id,
          },
          [Modules.SALES_CHANNEL]: {
            sales_channel_id: defaultChannel.id,
          },
        })

        linked++
      } catch (error: any) {
        logger.warn(
          `Failed to link product ${product.id} to sales channel: ${error.message}`
        )
      }
    }

    if (linked > 0) {
      logger.info(
        `Linked ${linked} orphaned product(s) to Default Sales Channel`
      )
    }

    logger.info(
      `Sales channel sync complete. Channel: ${defaultChannel.id}, Products: ${products.length} total, ${linked} newly linked`
    )
  } catch (error: any) {
    logger.error(
      "Error initializing sales channels:",
      error.message || error
    )
    // Don't throw - we want the backend to start even if this fails
  }
}
