/**
 * `POST /v1/seller/listings/:id/publish` — the W3 registry bridge.
 *
 * Route-handler harness per the seller plugins install spec: the exported
 * handler is called directly with hand-rolled req/res and a `scope.resolve`
 * switch. Signing uses a real PluginSigningService with a generated Ed25519
 * key so the stored envelopes are genuine; the registry is a recording stub.
 */

import { generateKeyPairSync } from "crypto"
import { POST } from "../[id]/publish/route"
import { MARKETPLACE_LISTING_MODULE } from "../../../../../modules/marketplace-listing"
import { MARKETPLACE_SIGNING_MODULE } from "../../../../../modules/marketplace-signing"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import PluginSigningService from "../../../../../modules/marketplace-signing/service"
import { verifyBlackoutEnvelope } from "../../../../../modules/marketplace-signing/verify"
import { PluginRegistryConflictError } from "../../../../../modules/plugin-registry/service"
import type { BlackoutSignatureEnvelope } from "../../../../../modules/marketplace-signing/verify"

const SELLER = "sel_123"

const extensionManifest = (over: Record<string, unknown> = {}) => ({
  id: "coop.fbm.featured-vendor-widget",
  name: "Featured Vendor Widget",
  version: "1.0.0",
  artifactKind: "manifest_plugin",
  capabilities: ["http.fetch"],
  homepageCard: { title: "Featured Vendors", to: "/marketplace/featured-vendors" },
  fbm: { minHostVersion: "1.0.0" },
  ...over,
})

const baseListing = (over: Record<string, unknown> = {}) => ({
  id: "cl_1",
  seller_id: SELLER,
  slug: "featured-vendor-widget",
  title: "Featured Vendor Widget",
  description: "Spotlight promoted vendors",
  version: "1.0.0",
  status: "draft",
  manifest: extensionManifest(),
  code_blob_url: null,
  code_blob_sha256: null,
  assets: null,
  plugin_slug: null,
  ...over,
})

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: {
      type?: string
      plugin?: { slug: string; version: string } | null
      [key: string]: unknown
    }
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

type PublishCall = {
  slug: string
  authorSellerId: string
  minHostVersion: string | null
  manifestUrl: string
  version_record: {
    manifest: Record<string, unknown>
    signature_envelope: Record<string, unknown>
    code_sha256: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

type RegistryBehavior = {
  existing?: { slug: string; author_seller_id: string | null } | null
  versions?: Array<{ version: string; code_sha256: string | null }>
  publishError?: Error
}

const makeHarness = (
  listing: Record<string, unknown> | null,
  registryBehavior: RegistryBehavior = {}
) => {
  const statusUpdates: Record<string, unknown>[] = []
  const published: Record<string, unknown>[] = []
  const publishes: PublishCall[] = []
  const dispatched: Array<Record<string, unknown>> = []
  const resolvedKeys: string[] = []
  let beginCalled = 0

  const listingService = {
    listCreatorListings: async () => (listing ? [listing] : []),
    beginPublish: async () => {
      beginCalled += 1
    },
    updateCreatorListings: async (data: Record<string, unknown>) => {
      statusUpdates.push(data)
      return data
    },
    markPublished: async (id: string, fields: Record<string, unknown>) => {
      published.push({ id, ...fields })
      return { id, status: "PUBLISHED", ...fields }
    },
  }

  const registry = {
    getBySlug: async () => registryBehavior.existing ?? null,
    listVersions: async () =>
      (registryBehavior.versions ?? []).map((v) => ({ ...v, yanked_at: null })),
    publishExtensionVersion: async (input: Record<string, unknown>) => {
      if (registryBehavior.publishError) {
        throw registryBehavior.publishError
      }
      publishes.push(input as unknown as PublishCall)
      return { listing: { slug: input.slug }, created: true, version: { id: "pv_1" } }
    },
  }

  const webhooks = {
    dispatch: async (event: string, channel: string, payload: Record<string, unknown>) => {
      dispatched.push({ event, channel, payload })
      return []
    },
  }

  const req = {
    params: { id: "cl_1" },
    seller_id: SELLER,
    headers: {},
    protocol: "https",
    scope: {
      resolve: (key: string) => {
        resolvedKeys.push(key)
        if (key === MARKETPLACE_LISTING_MODULE) return listingService
        if (key === MARKETPLACE_SIGNING_MODULE) return new PluginSigningService()
        if (key === MARKETPLACE_WEBHOOKS_MODULE) return webhooks
        if (key === PLUGIN_REGISTRY_MODULE) return registry
        return undefined
      },
    },
  }

  return {
    req,
    statusUpdates,
    published,
    publishes,
    dispatched,
    resolvedKeys,
    beginCalls: () => beginCalled,
  }
}

function withSigningKey<T>(fn: (publicKeyPem: string) => Promise<T>): Promise<T> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const prevPem = process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
  const prevKid = process.env.MARKETPLACE_SIGNING_KEY_ID
  const prevBase = process.env.BACKEND_URL
  process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
  process.env.MARKETPLACE_SIGNING_KEY_ID = "test-key-w3"
  process.env.BACKEND_URL = "https://api.fbm.test"
  const restore = () => {
    if (prevPem === undefined) delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM
    else process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = prevPem
    if (prevKid === undefined) delete process.env.MARKETPLACE_SIGNING_KEY_ID
    else process.env.MARKETPLACE_SIGNING_KEY_ID = prevKid
    if (prevBase === undefined) delete process.env.BACKEND_URL
    else process.env.BACKEND_URL = prevBase
  }
  return fn(publicKey.export({ type: "spki", format: "pem" }).toString()).finally(restore)
}

describe("publish — non-extension listings (dark proof)", () => {
  it("never resolves the plugin registry and reports plugin: null", async () => {
    await withSigningKey(async () => {
      const listing = baseListing({
        slug: "just-a-listing",
        manifest: { anything: "goes" },
        code_blob_url: "https://cdn.test/blob.zip",
        code_blob_sha256: "a".repeat(64),
      })
      const harness = makeHarness(listing)
      const res = createRes()
      await POST(harness.req as never, res as never)

      expect(res.statusCode).toBe(200)
      expect(res.body.plugin).toBeNull()
      expect(harness.publishes).toHaveLength(0)
      expect(harness.resolvedKeys).not.toContain(PLUGIN_REGISTRY_MODULE)
      expect(harness.published[0].signed_bundle_url).toBe("https://cdn.test/blob.zip")
      expect(harness.dispatched[0].payload).toMatchObject({ plugin: null })
    })
  })
})

describe("publish — extension bridge", () => {
  it("publishes a manifest_plugin without a code blob: signs, bridges, persists plugin columns", async () => {
    await withSigningKey(async (publicKeyPem) => {
      const harness = makeHarness(baseListing())
      const res = createRes()
      await POST(harness.req as never, res as never)

      expect(res.statusCode).toBe(200)
      expect(res.body.plugin).toEqual({ slug: "featured-vendor-widget", version: "1.0.0" })

      // The registry got the distribution manifest with the injected listing ref.
      expect(harness.publishes).toHaveLength(1)
      const publish = harness.publishes[0]
      expect(publish.slug).toBe("featured-vendor-widget")
      expect(publish.authorSellerId).toBe(SELLER)
      expect(publish.minHostVersion).toBe("1.0.0")
      const dist = publish.version_record.manifest as Record<string, unknown>
      expect(dist.listing).toEqual({
        providerId: "freeblackmarket",
        providerListingId: "cl_1",
        publicSlug: "featured-vendor-widget",
      })
      expect(publish.manifestUrl).toBe(
        "https://api.fbm.test/store/plugins/featured-vendor-widget/manifest"
      )

      // The stored envelope is the genuine Blackout distribution format.
      const envelope = publish.version_record
        .signature_envelope as unknown as BlackoutSignatureEnvelope
      expect(
        verifyBlackoutEnvelope(envelope, {
          manifest: dist,
          bundleSha256: publish.version_record.code_sha256 as string,
          publicKeyPem,
        })
      ).toEqual({ ok: true })

      // Blob-less manifest_plugin: the manifest URL doubles as the bundle URL.
      expect(harness.published[0].signed_bundle_url).toBe(
        "https://api.fbm.test/store/plugins/featured-vendor-widget/manifest"
      )
      // The two long-dead creator_listing columns are now written.
      expect(harness.statusUpdates).toContainEqual({
        id: "cl_1",
        plugin_slug: "featured-vendor-widget",
        plugin_version: "1.0.0",
      })
      expect(harness.dispatched[0].payload).toMatchObject({
        plugin: { slug: "featured-vendor-widget", version: "1.0.0" },
      })
    })
  })

  it("400s an invalid manifest BEFORE beginPublish (listing stays DRAFT)", async () => {
    await withSigningKey(async () => {
      const harness = makeHarness(
        baseListing({ manifest: extensionManifest({ version: "9.9.9" }) })
      )
      const res = createRes()
      await POST(harness.req as never, res as never)

      expect(res.statusCode).toBe(400)
      expect(res.body.type).toBe("invalid_extension_manifest")
      expect(harness.beginCalls()).toBe(0)
      expect(harness.statusUpdates).toHaveLength(0)
    })
  })

  it("409s a slug owned by another author before any status change", async () => {
    await withSigningKey(async () => {
      const harness = makeHarness(baseListing(), {
        existing: { slug: "featured-vendor-widget", author_seller_id: "sel_other" },
      })
      const res = createRes()
      await POST(harness.req as never, res as never)

      expect(res.statusCode).toBe(409)
      expect(res.body.type).toBe("plugin_slug_taken")
      expect(harness.beginCalls()).toBe(0)
    })
  })

  it("409s a repeat version with a different artifact; byte-identical retries proceed", async () => {
    await withSigningKey(async () => {
      const conflicting = makeHarness(
        baseListing({
          code_blob_url: "https://cdn.test/widget.zip",
          code_blob_sha256: "b".repeat(64),
          manifest: extensionManifest({ artifactKind: "code_plugin", sha256: "b".repeat(64) }),
        }),
        { versions: [{ version: "1.0.0", code_sha256: "a".repeat(64) }] }
      )
      const res1 = createRes()
      await POST(conflicting.req as never, res1 as never)
      expect(res1.statusCode).toBe(409)
      expect(res1.body.type).toBe("version_already_published")
      expect(conflicting.beginCalls()).toBe(0)

      const idempotent = makeHarness(
        baseListing({
          code_blob_url: "https://cdn.test/widget.zip",
          code_blob_sha256: "a".repeat(64),
          manifest: extensionManifest({ artifactKind: "code_plugin", sha256: "a".repeat(64) }),
        }),
        { versions: [{ version: "1.0.0", code_sha256: "a".repeat(64) }] }
      )
      const res2 = createRes()
      await POST(idempotent.req as never, res2 as never)
      expect(res2.statusCode).toBe(200)
    })
  })

  it("still requires a code blob for code_plugin extensions", async () => {
    await withSigningKey(async () => {
      const harness = makeHarness(
        baseListing({
          manifest: extensionManifest({ artifactKind: "code_plugin", sha256: "a".repeat(64) }),
        })
      )
      const res = createRes()
      await POST(harness.req as never, res as never)

      expect(res.statusCode).toBe(400)
      expect(res.body.type).toBe("missing_code_blob")
      expect(harness.beginCalls()).toBe(0)
    })
  })

  it("reverts to DRAFT when the registry write fails after signing", async () => {
    await withSigningKey(async () => {
      const conflict = makeHarness(baseListing(), {
        publishError: new PluginRegistryConflictError(
          "version_already_published",
          "raced"
        ),
      })
      const res1 = createRes()
      await POST(conflict.req as never, res1 as never)
      expect(res1.statusCode).toBe(409)
      expect(conflict.statusUpdates).toContainEqual({ id: "cl_1", status: "draft" })
      expect(conflict.published).toHaveLength(0)

      const broken = makeHarness(baseListing(), {
        publishError: new Error("db down"),
      })
      const res2 = createRes()
      await POST(broken.req as never, res2 as never)
      expect(res2.statusCode).toBe(502)
      expect(res2.body.type).toBe("registry_publish_failed")
      expect(broken.statusUpdates).toContainEqual({ id: "cl_1", status: "draft" })
    })
  })
})
