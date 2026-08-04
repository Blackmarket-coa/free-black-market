import { collectSellerUsage } from "../plan-usage"
import { EMBED_KEYS_MODULE } from "../../modules/embed-keys"
import { DOCUMENT_VAULT_MODULE } from "../../modules/document-vault"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { clearPlanFeatureCache } from "../plan-entitlement-cache"

/**
 * What matters here is that each count reproduces its enforcement point (a
 * dashboard that counts differently from the code that denies is worse than
 * none) and that a broken counter omits its row rather than claiming zero.
 */

const makeContainer = (
  opts: {
    planCode?: string
    embedKeys?: { revoked_at: Date | null }[]
    vaultDocs?: unknown[]
    webhooks?: unknown[]
    domains?: unknown
    broken?: string[]
  } = {}
) => {
  const broken = new Set(opts.broken ?? [])

  const container = {
    resolve: (key: string) => {
      if (broken.has(key)) throw new Error(`${key} unavailable`)

      if (key === VENDOR_PLAN_MODULE) {
        return {
          ensureAssignment: async () => ({
            plan_code: opts.planCode ?? "free",
          }),
          getEntitledFeatureKeys: async () => [],
        }
      }
      if (key === ENTITLEMENT_MODULE) {
        return { listActiveFeatureKeysForSeller: async () => [] }
      }
      if (key === EMBED_KEYS_MODULE) {
        return {
          listVendorEmbedKeys: async () => opts.embedKeys ?? [],
        }
      }
      if (key === DOCUMENT_VAULT_MODULE) {
        return { listForSeller: async () => opts.vaultDocs ?? [] }
      }
      if (key === MARKETPLACE_WEBHOOKS_MODULE) {
        return { listWebhookSubscriptions: async () => opts.webhooks ?? [] }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: async () => ({
            data: [{ connect_domains: opts.domains ?? [] }],
          }),
        }
      }
      return undefined
    },
  }

  return container as never
}

const byKey = (report: Awaited<ReturnType<typeof collectSellerUsage>>) =>
  new Map(report.resources.map((r) => [r.key, r]))

afterEach(() => clearPlanFeatureCache())

describe("collectSellerUsage", () => {
  it("counts every allowance against the seller's plan", async () => {
    const report = await collectSellerUsage(
      makeContainer({
        planCode: "free",
        embedKeys: [{ revoked_at: null }],
        vaultDocs: [{}, {}],
        webhooks: [{}],
        domains: ["shop.example.com"],
      }),
      "sel_1"
    )

    const resources = byKey(report)
    expect(report.plan_code).toBe("free")
    // Free allows 1 embed key, 1 domain, 1 webhook, 5 vault documents.
    expect(resources.get("embed_keys")).toMatchObject({
      current: 1,
      limit: 1,
      level: "at_limit",
    })
    expect(resources.get("vault_documents")).toMatchObject({
      current: 2,
      limit: 5,
    })
    expect(report.any_at_limit).toBe(true)
  })

  it("excludes revoked embed keys, mirroring the enforcement point", async () => {
    // Revoked keys consume nothing — counting them would leave a vendor
    // permanently unable to rotate at the cap, which is why the create route
    // excludes them too.
    const report = await collectSellerUsage(
      makeContainer({
        embedKeys: [
          { revoked_at: null },
          { revoked_at: new Date() },
          { revoked_at: new Date() },
        ],
      }),
      "sel_1"
    )
    expect(byKey(report).get("embed_keys")?.current).toBe(1)
  })

  it("omits a resource whose counter is broken rather than reporting zero", async () => {
    const report = await collectSellerUsage(
      makeContainer({
        broken: [DOCUMENT_VAULT_MODULE],
        embedKeys: [{ revoked_at: null }],
      }),
      "sel_1"
    )

    const resources = byKey(report)
    expect(resources.has("vault_documents")).toBe(false)
    // The rest of the report still renders.
    expect(resources.has("embed_keys")).toBe(true)
  })

  it("does not throw when every counter is broken", async () => {
    const report = await collectSellerUsage(
      makeContainer({
        broken: [
          EMBED_KEYS_MODULE,
          DOCUMENT_VAULT_MODULE,
          MARKETPLACE_WEBHOOKS_MODULE,
          ContainerRegistrationKeys.QUERY,
        ],
      }),
      "sel_1"
    )
    expect(report.resources).toEqual([])
    expect(report.any_at_limit).toBe(false)
    // Allowances come from the plan table, so they survive counter failures.
    expect(report.allowances.length).toBeGreaterThan(0)
  })

  it("treats a missing domain list as none rather than unavailable", async () => {
    // A seller who has never saved website settings has no row; that is a
    // real zero, not a failed count.
    const report = await collectSellerUsage(
      makeContainer({ domains: null }),
      "sel_1"
    )
    expect(byKey(report).get("connect_domains")?.current).toBe(0)
  })
})
