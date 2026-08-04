import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createLogger } from "./logger"
import { getSellerPlanLimits } from "./seller-plan"
import {
  buildUsageReport,
  type CountableLimitKey,
  type SellerUsageReport,
} from "../modules/vendor-plan/usage"
import { EMBED_KEYS_MODULE } from "../modules/embed-keys"
import type EmbedKeysService from "../modules/embed-keys/service"
import { DOCUMENT_VAULT_MODULE } from "../modules/document-vault"
import type DocumentVaultModuleService from "../modules/document-vault/service"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../modules/marketplace-webhooks"
import type MarketplaceWebhooksService from "../modules/marketplace-webhooks/service"
import { WebhookSubscriptionStatus } from "../modules/marketplace-webhooks/models/webhook-subscription"

const log = createLogger("shared/plan-usage")

/**
 * Count what a seller has consumed of each countable plan allowance.
 *
 * The composition point for the usage report: the four counters live in four
 * different modules (embed-keys, document-vault, marketplace-webhooks, and
 * `seller_metadata` for domains), none of which can reach the others, and
 * `vendor-plan` cannot reach any of them.
 *
 * **Each count mirrors its enforcement point exactly.** That is the whole
 * contract of this file — a dashboard that counts differently from the code
 * that denies is worse than no dashboard, because it teaches a vendor to
 * distrust the number right when they need it. Each counter below names the
 * route whose arithmetic it reproduces; if one of those changes, this must
 * change with it.
 *
 * A counter that throws yields `undefined` rather than `0`, and
 * `buildUsageReport` omits the row entirely — see the note there on why a
 * failed count must never render as "none used".
 */

/** Live embed keys. Mirrors `api/vendor/embed-keys/route.ts` POST. */
async function countEmbedKeys(
  container: MedusaContainer,
  sellerId: string
): Promise<number | undefined> {
  try {
    const service = container.resolve<EmbedKeysService>(EMBED_KEYS_MODULE)
    const keys = (await service.listVendorEmbedKeys({
      seller_id: sellerId,
    })) as unknown as { revoked_at: Date | null }[]
    // Revoked keys consume nothing — the same reason the enforcement point
    // excludes them, so a vendor at the cap can still rotate.
    return keys.filter((k) => !k.revoked_at).length
  } catch (err) {
    log.warn(`[usage] embed key count failed for ${sellerId}`, err)
    return undefined
  }
}

/** Vault documents. Mirrors `api/vendor/vault/route.ts` POST. */
async function countVaultDocuments(
  container: MedusaContainer,
  sellerId: string
): Promise<number | undefined> {
  try {
    const service = container.resolve<DocumentVaultModuleService>(
      DOCUMENT_VAULT_MODULE
    )
    const docs = await service.listForSeller(sellerId)
    return docs.length
  } catch (err) {
    log.warn(`[usage] vault document count failed for ${sellerId}`, err)
    return undefined
  }
}

/** Active webhook endpoints. Mirrors `api/v1/seller/webhooks/route.ts` POST. */
async function countWebhookSubscriptions(
  container: MedusaContainer,
  sellerId: string
): Promise<number | undefined> {
  try {
    const service = container.resolve<MarketplaceWebhooksService>(
      MARKETPLACE_WEBHOOKS_MODULE
    )
    const active = await service.listWebhookSubscriptions({
      seller_id: sellerId,
      status: WebhookSubscriptionStatus.ACTIVE,
    })
    return active.length
  } catch (err) {
    log.warn(`[usage] webhook subscription count failed for ${sellerId}`, err)
    return undefined
  }
}

/**
 * Connected domains. Mirrors `api/vendor/website/route.ts` POST.
 *
 * The stored list is already normalized (the write path normalizes before
 * saving and before checking), so its length is the same number the cap was
 * enforced against — no need to re-normalize here.
 */
async function countConnectDomains(
  container: MedusaContainer,
  sellerId: string
): Promise<number | undefined> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "seller_metadata",
      fields: ["connect_domains"],
      filters: { seller_id: sellerId },
    })
    const domains = data?.[0]?.connect_domains
    return Array.isArray(domains) ? domains.length : 0
  } catch (err) {
    log.warn(`[usage] connected domain count failed for ${sellerId}`, err)
    return undefined
  }
}

/**
 * Where a seller stands against every plan allowance.
 *
 * The counts run concurrently — they touch four unrelated modules and one
 * slow module should not serialize the rest of a dashboard read.
 *
 * Never throws: `getSellerPlanLimits` already degrades to the free tier's
 * limits rather than failing, and every counter degrades to "unavailable", so
 * the worst case is a thinner report rather than a 500 on a screen whose whole
 * job is to tell a vendor where they stand.
 */
export async function collectSellerUsage(
  container: MedusaContainer,
  sellerId: string
): Promise<SellerUsageReport> {
  const { plan_code, limits } = await getSellerPlanLimits(container, sellerId)

  const [embed_keys, vault_documents, webhook_subscriptions, connect_domains] =
    await Promise.all([
      countEmbedKeys(container, sellerId),
      countVaultDocuments(container, sellerId),
      countWebhookSubscriptions(container, sellerId),
      countConnectDomains(container, sellerId),
    ])

  const counts: Partial<Record<CountableLimitKey, number>> = {}
  if (embed_keys !== undefined) counts.embed_keys = embed_keys
  if (vault_documents !== undefined) counts.vault_documents = vault_documents
  if (webhook_subscriptions !== undefined) {
    counts.webhook_subscriptions = webhook_subscriptions
  }
  if (connect_domains !== undefined) counts.connect_domains = connect_domains

  return buildUsageReport(plan_code, limits, counts)
}
