import { GET, PUBLIC_PARTNER_ORG_FIELDS } from "../route"
import { PARTNER_DIRECTORY, PARTNER_DIRECTORY_MODULE } from "../../../../modules/partner-directory"
import { PHASE0_FEATURE_FLAGS } from "../../../../shared/feature-flags"
import {
  makeInMemoryDirectory,
  type OrgRow,
} from "../../../../modules/partner-directory/__tests__/in-memory-partner-orgs"

/**
 * `GET /store/partners` serves the refer-out directory: filters validated,
 * every row a link out, and nothing that is not display data — in
 * particular the curation note (`unverified_reason`) stays in the code.
 *
 * With FF_NONPROFIT_PARITY_V1 on it also serves `orgs`: published
 * pilot-partner records through an explicit allow-list. The service is the
 * real one (prototype + shadowed CRUD), so `listPublishedOrgs` filtering is
 * what keeps an unpublished row out — not the test.
 */

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

type RouteArgs = Parameters<typeof GET>
const call = async (
  query: Record<string, unknown>,
  orgs: Array<Partial<OrgRow> & { key: string; name: string }> = []
) => {
  const res = createRes()
  const dir = makeInMemoryDirectory(orgs)
  const scope = {
    resolve: (key: string) => (key === PARTNER_DIRECTORY_MODULE ? dir.service : undefined),
  }
  await GET({ query, scope } as unknown as RouteArgs[0], res as unknown as RouteArgs[1])
  return res
}

type Body = {
  partners: Array<Record<string, unknown>>
  count: number
  kinds: string[]
  serves: string[]
  orgs?: Array<Record<string, unknown>>
}

afterEach(() => {
  delete process.env[FLAG]
})

describe("GET /store/partners", () => {
  it("lists the whole directory with only display fields", async () => {
    const res = await call({})
    expect(res.statusCode).toBe(200)
    const body = res.body as Body
    expect(body.count).toBe(PARTNER_DIRECTORY.length)
    for (const row of body.partners) {
      expect(Object.keys(row).sort()).toEqual(
        ["key", "kind", "name", "products", "serves", "states", "tagline", "url"].sort()
      )
      expect(row).not.toHaveProperty("unverified_reason")
    }
    expect(body.kinds).toContain("cdfi")
    expect(body.serves).toContain("farm")
  })

  it("filters by kind list, state and audience", async () => {
    const body = (await call({ kind: "crowdfunder,microlender", state: "sc", serves: "farm" })).body as Body
    expect(body.partners.map((p) => p.key)).toEqual(["usda_fsa_microloans", "kiva_us"])
  })

  it("rejects an unknown kind, a bad state and an unknown audience", async () => {
    expect((await call({ kind: "payday" })).statusCode).toBe(400)
    expect((await call({ state: "South Carolina" })).statusCode).toBe(400)
    expect((await call({ serves: "landlord" })).statusCode).toBe(400)
  })
})

describe("GET /store/partners — partner orgs", () => {
  const seeded = (): Array<Partial<OrgRow> & { key: string; name: string }> => [
    {
      key: "published_org",
      name: "Published Org",
      org_type: "irs_501c3",
      ein: "123456789",
      verification_status: "pub78_eligible",
      verification_source: "irs_bulk_file",
      verified_as_of: new Date("2026-09-01T00:00:00Z"),
      verification_checked_at: new Date("2026-09-15T04:00:00Z"),
      stripe_connect_account_id: "acct_1PUBLISHED",
      published: true,
      url: "https://published.example",
      tagline: "Shown",
      states: ["Lowcountry"],
      serves: ["nonprofit"],
    },
    {
      key: "ground_up_liberation_project",
      name: "Ground Up Liberation Project",
      relationship: "sponsored_collective",
      published: false,
    },
  ]

  it("carries no orgs key at all while the flag is off", async () => {
    const body = (await call({}, seeded())).body as Body
    expect(body).not.toHaveProperty("orgs")
    expect(Object.keys(body).sort()).toEqual(["count", "kinds", "partners", "serves"])
  })

  it("with the flag on, lists only published orgs through the exact allow-list", async () => {
    process.env[FLAG] = "true"
    const body = (await call({}, seeded())).body as Body
    expect(body.orgs).toBeDefined()
    expect(body.orgs!.map((o) => o.key)).toEqual(["published_org"])

    const [org] = body.orgs!
    expect(Object.keys(org).sort()).toEqual([...PUBLIC_PARTNER_ORG_FIELDS].sort())
    expect(Object.keys(org).sort()).toEqual(
      [
        "key",
        "name",
        "org_type",
        "verification_status",
        "verified_as_of",
        "relationship",
        "fiscal_host_key",
        "url",
        "tagline",
        "states",
        "serves",
      ].sort()
    )
    expect(org).toMatchObject({
      key: "published_org",
      verification_status: "pub78_eligible",
      verified_as_of: new Date("2026-09-01T00:00:00Z"),
    })
    for (const secret of ["ein", "stripe_connect_account_id", "verification_source", "verification_checked_at", "id", "metadata"]) {
      expect(org).not.toHaveProperty(secret)
    }
    // The static directory is untouched by the flag.
    expect(body.count).toBe(PARTNER_DIRECTORY.length)
  })

  it("the unpublished GULP row never appears, even with the flag on", async () => {
    process.env[FLAG] = "true"
    const body = (await call({}, seeded())).body as Body
    expect(JSON.stringify(body)).not.toContain("ground_up_liberation_project")
  })

  it("flag on with no published orgs is an empty array, not an absent key", async () => {
    process.env[FLAG] = "true"
    const body = (await call({}, [seeded()[1]])).body as Body
    expect(body.orgs).toEqual([])
  })

  it("only the string \"true\" turns the collection on", async () => {
    process.env[FLAG] = "1"
    expect((await call({}, seeded())).body).not.toHaveProperty("orgs")
  })

  it("carries what the storefront badge needs — org_type, status and the IRS file date — for every published state", async () => {
    process.env[FLAG] = "true"
    const body = (await call({}, [
      {
        key: "c4_bmf",
        name: "A 501(c)(4)",
        org_type: "irs_501c4",
        ein: "000000001",
        verification_status: "bmf_only",
        verification_source: "irs_bulk_file",
        verified_as_of: new Date("2026-09-07T04:13:27Z"),
        verification_checked_at: new Date("2026-10-04T04:00:00Z"),
        published: true,
      },
      {
        // Published with an operator ack; the ingest leaves coops unverified and undated.
        key: "a_coop",
        name: "A Coop",
        org_type: "coop",
        verification_status: "unverified",
        published: true,
      },
      {
        // Auto-unpublished by the ingest when the IRS list said revoked: never shown.
        key: "revoked_c3",
        name: "Revoked",
        org_type: "irs_501c3",
        ein: "000000002",
        verification_status: "revoked",
        verified_as_of: new Date("2026-09-30T09:14:54Z"),
        published: false,
        metadata: { auto_unpublished: { reason: "unverified_irs_org" } },
      },
    ])).body as Body

    expect(body.orgs!.map((o) => o.key)).toEqual(["c4_bmf", "a_coop"])
    expect(body.orgs![0]).toMatchObject({
      org_type: "irs_501c4",
      verification_status: "bmf_only",
      verified_as_of: new Date("2026-09-07T04:13:27Z"),
    })
    expect(body.orgs![1]).toMatchObject({ org_type: "coop", verification_status: "unverified", verified_as_of: null })
    // The check time and the auto-unpublish record stay server-side.
    for (const o of body.orgs!) {
      expect(o).not.toHaveProperty("verification_checked_at")
      expect(o).not.toHaveProperty("metadata")
    }
    expect(JSON.stringify(body)).not.toContain("revoked")
  })
})
