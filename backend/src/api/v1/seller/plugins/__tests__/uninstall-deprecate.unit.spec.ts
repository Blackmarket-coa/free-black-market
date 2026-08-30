/**
 * `DELETE /v1/seller/plugins/:slug/install` + `POST .../deprecate` (W3).
 * Route-handler harness per install.unit.spec.ts (same mock-by-module-key
 * pattern; the entitlement module deliberately resolves undefined in some
 * cases to prove the best-effort guards hold).
 */

import { DELETE as uninstall } from "../[slug]/install/route"
import { POST as deprecate } from "../[slug]/deprecate/route"
import { defaultFeatureKeysForPlaybook } from "../../../../../shared/extension-keys"
import { SELLER_EXTENSION_MODULE } from "../../../../../modules/seller-extension"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"

const STALL_DEFAULTS = defaultFeatureKeysForPlaybook("stall")

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
    body: { already?: boolean; status?: string; [key: string]: unknown }
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

type MetaRow = {
  id: string
  seller_id: string
  vendor_type?: string | null
  enabled_extensions?: unknown
}

const makeHarness = (
  meta: MetaRow | null,
  opts?: {
    plugin?: Record<string, unknown> | null
  }
) => {
  const updated: Record<string, unknown>[] = []
  const created: Record<string, unknown>[] = []
  const registryUpdates: Record<string, unknown>[] = []
  const dispatched: Array<{ event: string; channel: string; payload: Record<string, unknown> }> = []

  const plugin =
    opts?.plugin === undefined
      ? { id: "pl_1", slug: "sales-analytics", status: "PUBLISHED", author_seller_id: "sel_123" }
      : opts.plugin

  const sellerExt = {
    listSellerMetadatas: async () => (meta ? [meta] : []),
    updateSellerMetadatas: async (data: Record<string, unknown>) => {
      updated.push(data)
      return data
    },
    createSellerMetadatas: async (data: Record<string, unknown>) => {
      created.push(data)
      return data
    },
  }

  const registry = {
    getBySlug: async () => plugin,
    decrementInstallCount: async () => ({ install_count: 2 }),
    updatePluginListings: async (data: Record<string, unknown>) => {
      registryUpdates.push(data)
      return data
    },
  }

  const webhooks = {
    dispatch: async (event: string, channel: string, payload: Record<string, unknown>) => {
      dispatched.push({ event, channel, payload })
      return []
    },
  }

  const req = {
    params: { slug: "sales-analytics" },
    seller_id: "sel_123",
    body: {},
    scope: {
      resolve: (key: string) => {
        if (key === SELLER_EXTENSION_MODULE) return sellerExt
        if (key === PLUGIN_REGISTRY_MODULE) return registry
        if (key === MARKETPLACE_WEBHOOKS_MODULE) return webhooks
        // ENTITLEMENT_MODULE deliberately unresolved: best-effort guards.
        return undefined
      },
    },
  }

  return { req, updated, created, registryUpdates, dispatched }
}

describe("seller plugin uninstall — enabled_extensions handling in reverse", () => {
  it("materializes defaults-minus-slug when the column is null and the slug is a default", async () => {
    // Pick a slug that IS in the stall defaults so removal from null matters.
    const defaultSlug = STALL_DEFAULTS[0]
    const harness = makeHarness({
      id: "smeta_1",
      seller_id: "sel_123",
      vendor_type: "maker",
      enabled_extensions: null,
    })
    ;(harness.req.params as { slug: string }).slug = defaultSlug
    const res = createRes()
    await uninstall(harness.req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(harness.updated).toHaveLength(1)
    const persisted = harness.updated[0].enabled_extensions as string[]
    expect(persisted).not.toContain(defaultSlug)
    // The rest of the defaults survive.
    for (const key of STALL_DEFAULTS.slice(1)) {
      expect(persisted).toContain(key)
    }
  })

  it("no-ops WITHOUT materializing when the slug is simply absent", async () => {
    const harness = makeHarness({
      id: "smeta_1",
      seller_id: "sel_123",
      vendor_type: "maker",
      enabled_extensions: ["hasProducts"],
    })
    const res = createRes()
    await uninstall(harness.req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body.already).toBe(true)
    expect(harness.updated).toHaveLength(0)
    expect(harness.created).toHaveLength(0)
    expect(harness.dispatched).toHaveLength(0)
  })

  it("removes an explicitly installed slug and emits the seller-shaped hook", async () => {
    const harness = makeHarness({
      id: "smeta_1",
      seller_id: "sel_123",
      vendor_type: "maker",
      enabled_extensions: ["hasProducts", "sales-analytics"],
    })
    const res = createRes()
    await uninstall(harness.req as never, res as never)

    expect(harness.updated[0].enabled_extensions).toEqual(["hasProducts"])
    expect(harness.dispatched).toEqual([
      {
        event: "plugin.uninstalled",
        channel: "plugin:sales-analytics",
        payload: {
          plugin_slug: "sales-analytics",
          installer_type: "seller",
          installer_seller_id: "sel_123",
        },
      },
    ])
  })

  it("404s an unknown plugin without touching extensions", async () => {
    const harness = makeHarness(
      { id: "smeta_1", seller_id: "sel_123", enabled_extensions: ["sales-analytics"] },
      { plugin: null }
    )
    const res = createRes()
    await uninstall(harness.req as never, res as never)
    expect(res.statusCode).toBe(404)
    expect(harness.updated).toHaveLength(0)
  })
})

describe("POST /v1/seller/plugins/:slug/deprecate", () => {
  it("author-only: 403 for non-authors and first-party plugins", async () => {
    const foreign = makeHarness(null, {
      plugin: { id: "pl_1", slug: "sales-analytics", status: "PUBLISHED", author_seller_id: "sel_other" },
    })
    const res = createRes()
    await deprecate(foreign.req as never, res as never)
    expect(res.statusCode).toBe(403)

    const firstParty = makeHarness(null, {
      plugin: { id: "pl_1", slug: "sales-analytics", status: "PUBLISHED", author_seller_id: null },
    })
    const res2 = createRes()
    await deprecate(firstParty.req as never, res2 as never)
    expect(res2.statusCode).toBe(403)
  })

  it("deprecates once, emits plugin.deprecated with the reason, and is idempotent", async () => {
    const harness = makeHarness(null)
    ;(harness.req as { body: unknown }).body = { reason: "superseded by v2" }
    const res = createRes()
    await deprecate(harness.req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ status: "DEPRECATED", already: false })
    expect(harness.registryUpdates).toEqual([{ id: "pl_1", status: "DEPRECATED" }])
    expect(harness.dispatched).toEqual([
      {
        event: "plugin.deprecated",
        channel: "plugin:sales-analytics",
        payload: { plugin_slug: "sales-analytics", reason: "superseded by v2" },
      },
    ])

    const already = makeHarness(null, {
      plugin: { id: "pl_1", slug: "sales-analytics", status: "DEPRECATED", author_seller_id: "sel_123" },
    })
    const res2 = createRes()
    await deprecate(already.req as never, res2 as never)
    expect(res2.statusCode).toBe(200)
    expect(res2.body.already).toBe(true)
    expect(already.registryUpdates).toHaveLength(0)
  })
})
