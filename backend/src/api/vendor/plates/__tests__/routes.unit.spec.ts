import { readFileSync } from "node:fs"
import path from "node:path"
import { JURISDICTION_RULES_MODULE } from "../../../../modules/jurisdiction-rules"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import { GET as listJurisdictions } from "../jurisdictions/route"
import { GET as getJurisdiction } from "../jurisdictions/[code]/route"

/**
 * `/vendor/plates/*`: what a seller is shown from the jurisdiction-rule store.
 *
 * Handler by handler, with the module doubled. The same routes through the
 * real middleware chain, on a migrated database, with the flag off and on:
 * `integration-tests/http/jurisdiction-rules-signoff.spec.ts`.
 *
 * The container double is keyed by the constant the routes import and throws
 * on any other key.
 */

type TestRes = {
  statusCode: number
  body: Record<string, unknown> | undefined
  status: (code: number) => TestRes
  json: (payload: Record<string, unknown>) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: Record<string, unknown>) => {
    res.body = payload
    return res
  }
  return res
}

const FLAG = PHASE0_FEATURE_FLAGS.PLATES_V1

const factSheet = {
  id: "jsrc_fs",
  issuer: "South Carolina Department of Agriculture",
  title: "Home-Based Food Production (Cottage Law)",
  url: "https://agriculture.sc.gov/retail-food-safety",
  document_id: "CPD Form #2210",
  document_date: "2026-05-01",
  document_date_note: "Printed in the footer as 5/1/26.",
  retrieved_at: "2026-11-17",
  content_sha256: "b".repeat(64),
  archive_ref: "docs/sources/us-sc/fact-sheet.pdf",
}
const faq = {
  ...factSheet,
  id: "jsrc_faq",
  title: "Are you interested in selling food out of your home?",
  document_id: null,
  document_date: null,
  document_date_note: "No date or form number is printed on the document.",
}

const view = {
  jurisdiction_code: "US-SC",
  jurisdiction_name: "South Carolina",
  program: "home_based_food",
  coverage: {
    status: "draft",
    required_rule_keys: ["label.product_name", "sales.online_delivery"],
    required_keys_not_reviewed: ["sales.online_delivery"],
    status_changed_at: "2026-11-21T00:00:00.000Z",
  },
  rules: [
    {
      id: "jrule_1",
      rule_key: "label.product_name",
      version: 1,
      kind: "requirement",
      value: { label_field: "product_name" },
      display_text: "The label must show the standard name of the product.",
      citations: [{ locator: "Labeling, item 2", quote: "The standard name of the product.", source: factSheet }],
      effective_from: null,
      effective_note: "Neither source states when this took effect.",
      review_status: "reviewed",
      reviewed_at: "2026-11-21T10:00:00.000Z",
      reviewer_name: "Ada Okafor",
      content_sha256: "a".repeat(64),
      correction_pending: false,
    },
    {
      id: "jrule_2",
      rule_key: "sales.online_delivery",
      version: 1,
      kind: "not_stated",
      value: { topic: "online_orders_shipping_delivery" },
      display_text: "Not addressed by our sources: neither document says anything about online orders.",
      citations: [
        { locator: "Whole document (1 page), read in full", quote: null, source: factSheet },
        { locator: "Whole document (2 pages), read in full", quote: null, source: faq },
      ],
      effective_from: null,
      effective_note: null,
      review_status: "draft",
      reviewed_at: null,
      reviewer_name: null,
      content_sha256: "c".repeat(64),
      correction_pending: false,
    },
  ],
}

function makeService() {
  return {
    listCoverage: jest.fn(async (program: string) => [
      { jurisdiction_code: "US-NC", jurisdiction_name: "North Carolina", program, opened: false, status: "not_covered", status_changed_at: null },
      { jurisdiction_code: "US-SC", jurisdiction_name: "South Carolina", program, opened: true, status: "draft", status_changed_at: "2026-11-21T00:00:00.000Z" },
    ]),
    getRuleView: jest.fn(async (_code: string, _program: string, _options: { includeDrafts: boolean }) => view),
  }
}

type Handler = (req: never, res: never) => Promise<unknown>

async function call(handler: Handler, options: { seller?: string | null; params?: Record<string, string> } = {}) {
  const service = makeService()
  const resolve = jest.fn((key: string) => {
    if (key === JURISDICTION_RULES_MODULE) return service
    throw new Error(`unexpected container key: ${key}`)
  })
  const seller = options.seller === undefined ? "sel_1" : options.seller
  const req = {
    params: options.params ?? {},
    scope: { resolve },
    auth_context: seller ? { actor_id: seller, actor_type: "seller" } : undefined,
  }
  const res = createRes()
  await handler(req as never, res as never)
  return { res, service, resolve }
}

describe("/vendor/plates", () => {
  afterEach(() => {
    delete process.env[FLAG]
  })

  describe("with FF_PLATES_V1 off", () => {
    it.each([
      ["GET /vendor/plates/jurisdictions", listJurisdictions as Handler, {}],
      ["GET /vendor/plates/jurisdictions/:code", getJurisdiction as Handler, { code: "US-SC" }],
    ] as Array<[string, Handler, Record<string, string>]>)("%s answers 404 feature_disabled and reads nothing", async (_name, handler, params) => {
      for (const value of [undefined, "", "1", "TRUE", "yes", "false"]) {
        if (value === undefined) delete process.env[FLAG]
        else process.env[FLAG] = value
        const { res, resolve } = await call(handler, { params })
        expect(res.statusCode).toBe(404)
        expect(res.body).toEqual({ type: "feature_disabled", message: "Feature flag FF_PLATES_V1 is disabled" })
        expect(resolve).not.toHaveBeenCalled()
      }
    })
  })

  describe("with FF_PLATES_V1 on", () => {
    beforeEach(() => {
      process.env[FLAG] = "true"
    })

    it("lists every state with its coverage, and nothing else about it", async () => {
      const { res, service } = await call(listJurisdictions as Handler)
      expect(res.statusCode).toBe(200)
      expect(service.listCoverage).toHaveBeenCalledWith("home_based_food")
      expect(res.body).toEqual({
        program: "home_based_food",
        count: 2,
        jurisdictions: [
          { code: "US-NC", name: "North Carolina", coverage: "not_covered", coverage_changed_at: null },
          { code: "US-SC", name: "South Carolina", coverage: "draft", coverage_changed_at: "2026-11-21T00:00:00.000Z" },
        ],
      })
    })

    it("asks for drafts too, by ISO code, whichever way the state was written", async () => {
      for (const code of ["US-SC", "us-sc", "SC", "South Carolina"]) {
        const { res, service } = await call(getJurisdiction as Handler, { params: { code } })
        expect(res.statusCode).toBe(200)
        expect(service.getRuleView).toHaveBeenCalledWith("US-SC", "home_based_food", { includeDrafts: true })
        expect(res.body).toMatchObject({ jurisdiction: { code: "US-SC", name: "South Carolina" }, program: "home_based_food", count: 2 })
      }
    })

    it("shows each rule with its source, document id and date, its review, and marks a draft as a draft", async () => {
      const { res } = await call(getJurisdiction as Handler, { params: { code: "US-SC" } })
      const [reviewed, draft] = (res.body as { rules: Array<Record<string, unknown>> }).rules

      expect(reviewed).toMatchObject({
        rule_key: "label.product_name",
        display_text: "The label must show the standard name of the product.",
        review_status: "reviewed",
        is_draft: false,
        reviewed_at: "2026-11-21T10:00:00.000Z",
        reviewer_name: "Ada Okafor",
        citations: [
          {
            locator: "Labeling, item 2",
            quote: "The standard name of the product.",
            source: {
              issuer: "South Carolina Department of Agriculture",
              title: "Home-Based Food Production (Cottage Law)",
              document_id: "CPD Form #2210",
              document_id_text: "CPD Form #2210",
              document_date: "2026-05-01",
              document_date_text: "2026-05-01",
            },
          },
        ],
      })
      expect(draft).toMatchObject({
        rule_key: "sales.online_delivery",
        kind: "not_stated",
        review_status: "draft",
        is_draft: true,
        reviewed_at: null,
        reviewer_name: null,
      })
    })

    it('reads "not stated" for a missing effective date, document date and document id, and leaves the raw value null', async () => {
      const { res } = await call(getJurisdiction as Handler, { params: { code: "US-SC" } })
      const [reviewed, draft] = (res.body as { rules: Array<Record<string, unknown>> }).rules

      for (const rule of [reviewed, draft]) {
        expect(rule).toMatchObject({ effective_from: null, effective_date_text: "not stated" })
      }
      const faqSource = (draft.citations as Array<{ source: Record<string, unknown> }>)[1].source
      expect(faqSource).toMatchObject({
        document_id: null,
        document_id_text: "not stated",
        document_date: null,
        document_date_text: "not stated",
        document_date_note: "No date or form number is printed on the document.",
      })
    })

    it("answers 200 and not_covered for a state with nothing on file: that is an answer, not an error", async () => {
      const service = makeService()
      service.getRuleView.mockResolvedValue({
        ...view,
        jurisdiction_code: "US-NC",
        jurisdiction_name: "North Carolina",
        coverage: { status: "not_covered", required_rule_keys: [], required_keys_not_reviewed: [], status_changed_at: null as unknown as string },
        rules: [],
      })
      const resolve = jest.fn((key: string) => {
        if (key === JURISDICTION_RULES_MODULE) return service
        throw new Error(`unexpected container key: ${key}`)
      })
      const res = createRes()
      await (getJurisdiction as Handler)(
        { params: { code: "NC" }, scope: { resolve }, auth_context: { actor_id: "sel_1", actor_type: "seller" } } as never,
        res as never
      )
      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({ jurisdiction: { code: "US-NC", name: "North Carolina" }, coverage: { status: "not_covered" }, rules: [], count: 0 })
    })

    it("answers 404 for a code that is not a US state or DC, without reading anything", async () => {
      for (const code of ["ZZ", "US-PR", "Charleston County", "44"]) {
        const { res, service } = await call(getJurisdiction as Handler, { params: { code } })
        expect(res.statusCode).toBe(404)
        expect(res.body).toMatchObject({ type: "not_found" })
        expect(service.getRuleView).not.toHaveBeenCalled()
      }
    })

    it("answers 401 without a seller", async () => {
      for (const handler of [listJurisdictions as Handler, getJurisdiction as Handler]) {
        const { res, resolve } = await call(handler, { seller: null, params: { code: "US-SC" } })
        expect(res.statusCode).toBe(401)
        expect(resolve).not.toHaveBeenCalled()
      }
    })
  })

  it("is registered behind the flag in api/middlewares.ts, after seller authentication and with no plan gate", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../middlewares.ts"), "utf8")
    const blocks = source.split(/\n\s*\{\s*\n/).filter((block) => block.includes('matcher: "/vendor/plates'))
    // One matcher, and its glob covers every route under /vendor/plates.
    expect(blocks).toHaveLength(1)
    const [block] = blocks
    expect(block).toContain('matcher: "/vendor/plates*"')
    expect(block).toContain('requireFeatureFlagMiddleware("PLATES_V1")')
    expect(block.indexOf('authenticate("seller", "bearer")')).toBeGreaterThan(-1)
    expect(block.indexOf('authenticate("seller", "bearer")')).toBeLessThan(block.indexOf('requireFeatureFlagMiddleware("PLATES_V1")'))
    expect(block.split("\n    },")[0]).not.toContain("requirePlanFeature(")
  })
})
