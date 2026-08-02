/**
 * `POST /v1/seller/plugins/:slug/install`
 *
 * Regression cover for the lockout defect: a seller whose `enabled_extensions`
 * is `null` (meaning "use my archetype defaults") had the slug appended to an
 * empty array, persisting a slug-only array. The vendor-panel resolves any
 * non-null array as a custom selection and flips on only recognised `hasX`
 * keys — so a slug-only array reads as "every dashboard feature off".
 *
 * Route-handler harness per `api/vendor/__tests__/invoices-route.unit.spec.ts`:
 * the exported handler is called directly with hand-rolled req/res and a
 * `scope.resolve` switch.
 */

import { POST } from "../[slug]/install/route"
import { defaultFeatureKeysForPlaybook } from "../../../../../shared/extension-keys"
// Imported rather than hardcoded: the module-key strings in this repo are
// inconsistently cased (`sellerExtension`, `plugin_registry`,
// `marketplaceWebhooks`), so a literal in the mock silently drifts.
import { SELLER_EXTENSION_MODULE } from "../../../../../modules/seller-extension"
import { PLUGIN_REGISTRY_MODULE } from "../../../../../modules/plugin-registry"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../../../../modules/marketplace-webhooks"

const STALL_DEFAULTS = defaultFeatureKeysForPlaybook("stall")

type MetaRow = {
  id: string
  seller_id: string
  vendor_type?: string | null
  enabled_extensions?: unknown
}

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
    body: Record<string, unknown>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

const makeHarness = (meta: MetaRow | null, opts?: { pluginExists?: boolean }) => {
  const updated: Record<string, unknown>[] = []
  const created: Record<string, unknown>[] = []

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
    getBySlug: async (slug: string) =>
      opts?.pluginExists === false ? null : { slug, install_count: 3 },
    incrementInstallCount: async () => ({ install_count: 4 }),
  }

  const dispatched: Array<{ event: string; channel: string }> = []
  const webhooks = {
    dispatch: async (event: string, channel: string) => {
      dispatched.push({ event, channel })
      return []
    },
  }

  const req = {
    params: { slug: "sales-analytics" },
    seller_id: "sel_123",
    scope: {
      resolve: (key: string) => {
        if (key === SELLER_EXTENSION_MODULE) return sellerExt
        if (key === PLUGIN_REGISTRY_MODULE) return registry
        if (key === MARKETPLACE_WEBHOOKS_MODULE) return webhooks
        return undefined
      },
    },
  }

  return { req, updated, created, dispatched }
}

describe("plugin install — enabled_extensions handling", () => {
  it("materialises archetype defaults instead of persisting a slug-only array", async () => {
    // The defect: this used to write ["sales-analytics"], zeroing all 14 features.
    const { req, updated } = makeHarness({
      id: "smeta_1",
      seller_id: "sel_123",
      vendor_type: "maker",
      enabled_extensions: null,
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(updated).toHaveLength(1)

    const persisted = updated[0].enabled_extensions as string[]
    expect(persisted).toContain("sales-analytics")
    expect(persisted).not.toEqual(["sales-analytics"])
    for (const key of STALL_DEFAULTS) {
      expect(persisted).toContain(key)
    }
  })

  it("appends to an existing custom selection without disturbing it", async () => {
    const { req, updated, dispatched } = makeHarness({
      id: "smeta_1",
      seller_id: "sel_123",
      vendor_type: "maker",
      enabled_extensions: ["hasProducts", "hasMenu"],
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(updated[0].enabled_extensions).toEqual([
      "hasProducts",
      "hasMenu",
      "sales-analytics",
    ])
    expect(dispatched).toEqual([
      { event: "plugin.installed", channel: "plugin:sales-analytics" },
    ])
  })

  it("respects a deliberate empty selection", async () => {
    // `[]` is "everything off" by choice — appending must not repopulate it.
    const { req, updated } = makeHarness({
      id: "smeta_1",
      seller_id: "sel_123",
      vendor_type: "maker",
      enabled_extensions: [],
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(updated[0].enabled_extensions).toEqual(["sales-analytics"])
  })

  it("is idempotent for an already-installed plugin", async () => {
    const { req, updated } = makeHarness({
      id: "smeta_1",
      seller_id: "sel_123",
      vendor_type: "maker",
      enabled_extensions: ["hasProducts", "sales-analytics"],
    })
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.body.already).toBe(true)
    expect(updated).toHaveLength(0)
  })

  it("seeds defaults when the seller has no metadata row at all", async () => {
    const { req, created } = makeHarness(null)
    const res = createRes()

    await POST(req as never, res as never)

    expect(created).toHaveLength(1)
    const persisted = created[0].enabled_extensions as string[]
    expect(persisted).toContain("sales-analytics")
    // No metadata row means no archetype, so this falls back to stall defaults
    // rather than to an empty array.
    expect(persisted).not.toEqual(["sales-analytics"])
  })

  it("404s for an unknown plugin without touching extensions", async () => {
    const { req, updated, created } = makeHarness(
      { id: "smeta_1", seller_id: "sel_123", enabled_extensions: null },
      { pluginExists: false }
    )
    const res = createRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(updated).toHaveLength(0)
    expect(created).toHaveLength(0)
  })
})
