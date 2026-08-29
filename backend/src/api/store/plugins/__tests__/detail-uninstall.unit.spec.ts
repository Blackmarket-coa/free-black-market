/**
 * `GET /store/plugins/:slug` + `GET .../manifest` + `DELETE .../install` (W3).
 * Route-handler harness per the seller plugins install spec.
 */

import { GET as getDetail } from "../[slug]/route"
import { GET as getManifest } from "../[slug]/manifest/route"
import { DELETE as uninstall } from "../[slug]/install/route"
import { PLUGIN_REGISTRY_MODULE } from "../../../../modules/plugin-registry"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../modules/marketplace-webhooks"

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined, headers: {} }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  res.setHeader = (name: string, value: string) => {
    ;(res.headers as Record<string, string>)[name] = value
    return res
  }
  return res as {
    statusCode: number
    body: {
      slug?: string
      id?: string
      installable?: { ok: boolean; code?: string }
      latest_version?: { signature_envelope: { keyId: string } } | null
      versions?: unknown[]
      has_third_party_author?: boolean
      [key: string]: unknown
    }
    headers: Record<string, string>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
    setHeader: (n: string, v: string) => unknown
  }
}

const PLUGIN = {
  id: "pl_1",
  slug: "featured-vendor-widget",
  name: "Featured Vendor Widget",
  category: "MARKETPLACE_EXTENSION",
  description: "Spotlight promoted vendors",
  status: "PUBLISHED",
  version: "1.0.0",
  min_host_version: "1.0.0",
  max_host_version: null,
  manifest_url: "https://api.fbm.test/store/plugins/featured-vendor-widget/manifest",
  icon_url: null,
  install_count: 7,
  author_seller_id: "sel_author",
}

const VERSION_ROW = {
  version: "1.0.0",
  published_at: "2026-08-29T00:00:00.000Z",
  code_sha256: "a".repeat(64),
  signed_bundle_url: PLUGIN.manifest_url,
  signature_envelope: { keyId: "k1", signature: "s", manifestSha256: "m", sha256: "b", issuedAt: "t" },
  manifest_url: PLUGIN.manifest_url,
  manifest: { id: "coop.fbm.featured-vendor-widget", version: "1.0.0", artifactKind: "manifest_plugin" },
  yanked_at: null,
}

const makeReq = (over: Record<string, unknown> = {}, behavior: Record<string, unknown> = {}) => {
  const revoked: string[] = []
  const dispatched: Array<{ event: string; channel: string; payload: Record<string, unknown> }> = []
  const registry = {
    getBySlug: async () => (behavior.plugin === undefined ? PLUGIN : behavior.plugin),
    getLatestVersion: async () =>
      behavior.latest === undefined ? VERSION_ROW : behavior.latest,
    listVersions: async () =>
      behavior.versions === undefined ? [VERSION_ROW] : behavior.versions,
    decrementInstallCount: async () => ({ install_count: 6 }),
  }
  const entitlements = {
    verify: async () =>
      behavior.entitled === false
        ? { entitled: false, entitlements: [] }
        : { entitled: true, entitlements: [{ id: "ent_1" }, { id: "ent_2" }] },
    revoke: async (id: string) => {
      revoked.push(id)
      return { id }
    },
  }
  const webhooks = {
    dispatch: async (event: string, channel: string, payload: Record<string, unknown>) => {
      dispatched.push({ event, channel, payload })
      return []
    },
  }
  const req = {
    params: { slug: "featured-vendor-widget" },
    query: {},
    auth_context: { actor_id: "cus_1" },
    scope: {
      resolve: (key: string) => {
        if (key === PLUGIN_REGISTRY_MODULE) return registry
        if (key === ENTITLEMENT_MODULE) return entitlements
        if (key === MARKETPLACE_WEBHOOKS_MODULE) return webhooks
        return undefined
      },
    },
    ...over,
  }
  return { req, revoked, dispatched }
}

describe("GET /store/plugins/:slug", () => {
  it("returns catalog fields, compat verdict, and the latest version envelope", async () => {
    const { req } = makeReq()
    const res = createRes()
    await getDetail(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.slug).toBe("featured-vendor-widget")
    expect(res.body.installable).toEqual({ ok: true })
    expect(res.body.has_third_party_author).toBe(true)
    expect(res.body.latest_version?.signature_envelope.keyId).toBe("k1")
    expect(res.body.versions).toBeUndefined()
  })

  it("includes non-yanked history under ?include=versions and 404s unknown/draft", async () => {
    const withHistory = makeReq({ query: { include: "versions" } })
    const res = createRes()
    await getDetail(withHistory.req as never, res as never)
    expect(res.body.versions).toHaveLength(1)

    const missing = makeReq({}, { plugin: null })
    const res404 = createRes()
    await getDetail(missing.req as never, res404 as never)
    expect(res404.statusCode).toBe(404)

    const draft = makeReq({}, { plugin: { ...PLUGIN, status: "DRAFT" } })
    const resDraft = createRes()
    await getDetail(draft.req as never, resDraft as never)
    expect(resDraft.statusCode).toBe(404)
  })

  it("reports the compat block for deprecated plugins without hiding them", async () => {
    const { req } = makeReq({}, { plugin: { ...PLUGIN, status: "DEPRECATED" } })
    const res = createRes()
    await getDetail(req as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body.installable?.ok).toBe(false)
    expect(res.body.installable?.code).toBe("deprecated")
  })
})

describe("GET /store/plugins/:slug/manifest", () => {
  it("serves the latest distribution manifest with caching, honors ?version=, 404s when none", async () => {
    const latest = makeReq()
    const res = createRes()
    await getManifest(latest.req as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body.id).toBe("coop.fbm.featured-vendor-widget")
    expect(res.headers["cache-control"]).toBe("public, max-age=300")

    const pinned = makeReq({ query: { version: "1.0.0" } })
    const resPinned = createRes()
    await getManifest(pinned.req as never, resPinned as never)
    expect(resPinned.statusCode).toBe(200)

    const missingVersion = makeReq({ query: { version: "9.9.9" } })
    const res404 = createRes()
    await getManifest(missingVersion.req as never, res404 as never)
    expect(res404.statusCode).toBe(404)

    const noHistory = makeReq({}, { latest: null, versions: [] })
    const resNone = createRes()
    await getManifest(noHistory.req as never, resNone as never)
    expect(resNone.statusCode).toBe(404)
  })
})

describe("DELETE /store/plugins/:slug/install", () => {
  it("revokes every live entitlement, decrements, and emits a customer-shaped hook", async () => {
    const { req, revoked, dispatched } = makeReq()
    const res = createRes()
    await uninstall(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ uninstalled: true, already: false, revoked: 2 })
    expect(revoked).toEqual(["ent_1", "ent_2"])
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].event).toBe("plugin.uninstalled")
    // Privacy: customer uninstalls never ship a customer id.
    expect(dispatched[0].payload).toEqual({
      plugin_slug: "featured-vendor-widget",
      installer_type: "customer",
    })
  })

  it("is idempotent when nothing is installed and 401s without auth", async () => {
    const notEntitled = makeReq({}, { entitled: false })
    const res = createRes()
    await uninstall(notEntitled.req as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ uninstalled: false, already: true })

    const anonymous = makeReq({ auth_context: {} })
    const res401 = createRes()
    await uninstall(anonymous.req as never, res401 as never)
    expect(res401.statusCode).toBe(401)
  })
})
