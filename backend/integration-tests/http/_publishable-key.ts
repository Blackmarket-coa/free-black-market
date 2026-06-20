import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Create a publishable API key linked to a fresh sales channel and return its
 * token.
 *
 * Medusa's /store/* routes require an `x-publishable-api-key` header, and the
 * write paths additionally require that key to resolve to a sales channel
 * ("A valid publishable key is required to proceed"). These smoke specs exercise
 * store routes without seeding a storefront, so they mint a throwaway key +
 * sales channel and pass the token. Use as:
 *
 *   const pak = pakHeaders(await createPublishableKeyToken(getContainer))
 *   await api.get("/store/...", pak)
 */
export async function createPublishableKeyToken(
  getContainer: () => any,
): Promise<string> {
  const container = getContainer()
  const apiKeyModule = container.resolve(Modules.API_KEY)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  const salesChannel = await salesChannelModule.createSalesChannels({
    name: `integration-test-${Math.random().toString(36).slice(2)}`,
  })
  const [key] = await apiKeyModule.createApiKeys([
    { title: "integration-test", type: "publishable", created_by: "test" },
  ])
  await link.create({
    [Modules.API_KEY]: { publishable_key_id: key.id },
    [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannel.id },
  })

  return key.token
}

export function pakHeaders(token: string) {
  return { headers: { "x-publishable-api-key": token } }
}
