import { POST as CREATE_EMBED_KEY } from "../embed-keys/route"
import { GET as GET_EMBED_ANALYTICS } from "../analytics/embed/route"
import { POST as CREATE_VAULT_DOC } from "../vault/route"
import { VENDOR_PLAN_MODULE } from "../../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../../modules/entitlement"
import { EMBED_KEYS_MODULE } from "../../../modules/embed-keys"
import { EMBED_ANALYTICS_MODULE } from "../../../modules/embed-analytics"
import { DOCUMENT_VAULT_MODULE } from "../../../modules/document-vault"
import { clearPlanFeatureCache } from "../../../shared/plan-entitlement-cache"
import { limitsForPlan } from "../../../modules/vendor-plan/limits"

/**
 * Route-handler harness per `invoices-route.unit.spec.ts`. `requireSellerId` is
 * mocked because these tests are about plan limits, not seller resolution.
 */
jest.mock("../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_1"),
}))

/**
 * The size measurement is a network call against the object store. Mocked here
 * because these tests are about the cap arithmetic, not about the probe —
 * `shared/__tests__/file-size.unit.spec.ts` covers the probe itself, including
 * the case this variable models with `null`: a file we could not measure.
 */
let mockMeasuredBytes: number | null = null
jest.mock("../../../shared/file-size", () => {
  const actual = jest.requireActual("../../../shared/file-size")
  return {
    ...actual,
    measureFileBytes: jest.fn(async () => mockMeasuredBytes),
  }
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
    body: Record<string, unknown>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

type Deps = {
  planCode?: string
  embedKeys?: { revoked_at: Date | null }[]
  vaultDocs?: unknown[]
  /** Bytes the seller already holds. */
  vaultBytes?: number
  /** Bytes the incoming file measures. `null` mimics an unmeasurable upload. */
  measuredBytes?: number | null
}

const makeReq = (
  deps: Deps = {},
  extra: Record<string, unknown> = {}
) => {
  mockMeasuredBytes = deps.measuredBytes ?? null

  const generateKey = jest.fn(async () => ({
    id: "vek_1",
    key: "pk_live_abc",
    last_four: "cabc",
    label: null,
    created_at: new Date("2026-08-02"),
  }))
  const createVaultDocuments = jest.fn(async () => ({ id: "vd_1" }))
  const aggregateForSeller = jest.fn(
    async (_seller: string, rangeDays: number) => ({
      range_days: rangeDays,
      totals: {},
      funnel: { views: 0, add_to_cart: 0, checkout_start: 0, orders: 0 },
      by_origin: [],
      by_day: [],
      top_products: [],
    })
  )

  const req = {
    body: {},
    query: {},
    params: {},
    scope: {
      resolve: (key: string) => {
        switch (key) {
          case VENDOR_PLAN_MODULE:
            return {
              ensureAssignment: async () => ({
                plan_code: deps.planCode ?? "free",
              }),
              getEntitledFeatureKeys: async () => [],
            }
          case ENTITLEMENT_MODULE:
            return { listActiveFeatureKeysForSeller: async () => [] }
          case EMBED_KEYS_MODULE:
            return {
              listVendorEmbedKeys: async () => deps.embedKeys ?? [],
              generateKey,
            }
          case EMBED_ANALYTICS_MODULE:
            return { aggregateForSeller }
          case DOCUMENT_VAULT_MODULE:
            return {
              listForSeller: async () => deps.vaultDocs ?? [],
              storageBytesForSeller: async () => deps.vaultBytes ?? 0,
              createVaultDocuments,
            }
          default:
            return undefined
        }
      },
    },
    ...extra,
  }

  return { req, generateKey, createVaultDocuments, aggregateForSeller }
}

beforeEach(() => {
  clearPlanFeatureCache()
})

describe("POST /vendor/embed-keys", () => {
  it("issues a key when the plan has room", async () => {
    const { req, generateKey } = makeReq({ planCode: "free", embedKeys: [] })
    const res = createRes()
    await CREATE_EMBED_KEY(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(generateKey).toHaveBeenCalled()
  })

  it("refuses with a 402 once the plan's keys are used up", async () => {
    const { req, generateKey } = makeReq({
      planCode: "free",
      embedKeys: [{ revoked_at: null }],
    })
    const res = createRes()
    await CREATE_EMBED_KEY(req as never, res as never)

    expect(res.statusCode).toBe(402)
    expect(res.body.code).toBe("plan_limit_reached")
    expect(res.body.limit_key).toBe("embed_keys")
    expect(generateKey).not.toHaveBeenCalled()
  })

  it("does not count revoked keys against the cap", async () => {
    // Otherwise a vendor at their cap could never rotate a leaked key — the
    // exact moment they most need to issue a new one.
    const { req, generateKey } = makeReq({
      planCode: "free",
      embedKeys: [{ revoked_at: new Date("2026-01-01") }],
    })
    const res = createRes()
    await CREATE_EMBED_KEY(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(generateKey).toHaveBeenCalled()
  })

  it("lets a higher plan hold more keys", async () => {
    const { req, generateKey } = makeReq({
      planCode: "pro",
      embedKeys: Array.from({ length: 3 }, () => ({ revoked_at: null })),
    })
    const res = createRes()
    await CREATE_EMBED_KEY(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(generateKey).toHaveBeenCalled()
  })
})

describe("GET /vendor/analytics/embed", () => {
  it("clamps the range to the plan rather than refusing", async () => {
    // A 402 would leave the vendor staring at an error where a shorter chart
    // would have told them something true.
    const { req, aggregateForSeller } = makeReq({ planCode: "free" }, {
      query: { range: "365" },
    })
    const res = createRes()
    await GET_EMBED_ANALYTICS(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(aggregateForSeller).toHaveBeenCalledWith(
      "sel_1",
      limitsForPlan("free").analytics_range_days
    )
  })

  it("reports the ceiling so the panel can offer the upsell in place", async () => {
    const { req } = makeReq({ planCode: "free" }, { query: { range: "365" } })
    const res = createRes()
    await GET_EMBED_ANALYTICS(req as never, res as never)

    const range = res.body.range as Record<string, unknown>
    expect(range.requested_days).toBe(365)
    expect(range.applied_days).toBe(limitsForPlan("free").analytics_range_days)
    expect(range.truncated).toBe(true)
    expect(range.current_plan).toBe("free")
  })

  it("leaves a request inside the plan's window alone", async () => {
    const { req, aggregateForSeller } = makeReq({ planCode: "scale" }, {
      query: { range: "90" },
    })
    const res = createRes()
    await GET_EMBED_ANALYTICS(req as never, res as never)

    expect(aggregateForSeller).toHaveBeenCalledWith("sel_1", 90)
    expect((res.body.range as Record<string, unknown>).truncated).toBe(false)
  })
})

describe("POST /vendor/vault", () => {
  const authed = { auth_context: { actor_id: "sel_1" }, body: { label: "Lease" } }

  it("records a document while under the cap", async () => {
    const { req, createVaultDocuments } = makeReq(
      { planCode: "free", vaultDocs: [] },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createVaultDocuments).toHaveBeenCalled()
  })

  it("refuses with a 402 at the cap", async () => {
    const { req, createVaultDocuments } = makeReq(
      {
        planCode: "free",
        vaultDocs: Array.from(
          { length: limitsForPlan("free").vault_documents as number },
          (_, i) => ({ id: `vd_${i}` })
        ),
      },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(402)
    expect(res.body.limit_key).toBe("vault_documents")
    expect(createVaultDocuments).not.toHaveBeenCalled()
  })

  it("never caps the operator plan", async () => {
    const { req, createVaultDocuments } = makeReq(
      {
        planCode: "internal",
        vaultDocs: Array.from({ length: 10_000 }, (_, i) => ({ id: `vd_${i}` })),
        vaultBytes: 500 * 1024 * 1024 * 1024,
        measuredBytes: 5 * 1024 * 1024 * 1024,
      },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createVaultDocuments).toHaveBeenCalled()
  })

  it("records the measured size on the document", async () => {
    const { req, createVaultDocuments } = makeReq(
      { planCode: "free", vaultDocs: [], measuredBytes: 4_096 },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createVaultDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ bytes_stored: 4_096 })
    )
  })

  it("refuses with a 402 when the file would exceed the storage quota", async () => {
    // Well under the 5-document cap — this is the case a count-only cap missed
    // entirely: one enormous file rather than many small ones.
    const free = limitsForPlan("free").vault_storage_bytes as number
    const { req, createVaultDocuments } = makeReq(
      {
        planCode: "free",
        vaultDocs: [{ id: "vd_0" }],
        vaultBytes: free - 1_000,
        measuredBytes: 50 * 1024 * 1024,
      },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(402)
    expect(res.body.limit_key).toBe("vault_storage_bytes")
    // The raw figures stay machine-readable; only the message is humanised.
    expect(res.body.limit).toBe(free)
    expect(res.body.message).toContain("100.0 MB")
    expect(createVaultDocuments).not.toHaveBeenCalled()
  })

  it("admits a file that exactly fills the remaining quota", async () => {
    const free = limitsForPlan("free").vault_storage_bytes as number
    const { req, createVaultDocuments } = makeReq(
      {
        planCode: "free",
        vaultDocs: [{ id: "vd_0" }],
        vaultBytes: free - 1_000,
        measuredBytes: 1_000,
      },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createVaultDocuments).toHaveBeenCalled()
  })

  it("stores an unmeasurable file rather than failing the upload", async () => {
    // Metering must never become an availability problem on somebody's
    // document. The row is written with an unknown size, contributing nothing
    // to the quota — understating rather than guessing upward.
    const free = limitsForPlan("free").vault_storage_bytes as number
    const { req, createVaultDocuments } = makeReq(
      {
        planCode: "free",
        vaultDocs: [{ id: "vd_0" }],
        vaultBytes: free,
        measuredBytes: null,
      },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(createVaultDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ bytes_stored: null })
    )
  })

  it("checks the document count before the storage quota", async () => {
    // Both are breached; the count denial is the cheaper and more actionable
    // message, and it must not be shadowed by the byte one.
    const { req } = makeReq(
      {
        planCode: "free",
        vaultDocs: Array.from(
          { length: limitsForPlan("free").vault_documents as number },
          (_, i) => ({ id: `vd_${i}` })
        ),
        vaultBytes: limitsForPlan("free").vault_storage_bytes as number,
        measuredBytes: 1_000,
      },
      authed
    )
    const res = createRes()
    await CREATE_VAULT_DOC(req as never, res as never)

    expect(res.statusCode).toBe(402)
    expect(res.body.limit_key).toBe("vault_documents")
  })
})
