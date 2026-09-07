import { GET } from "../route"
import { PARTNER_DIRECTORY, PARTNER_DIRECTORY_MODULE } from "../../../../modules/partner-directory"
import PartnerDirectoryModuleService from "../../../../modules/partner-directory/service"

/**
 * `GET /store/partners` serves the refer-out directory: filters validated,
 * every row a link out, and nothing that is not display data — in
 * particular the curation note (`unverified_reason`) stays in the code.
 */

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
const call = async (query: Record<string, unknown>) => {
  const res = createRes()
  const scope = {
    resolve: (key: string) => (key === PARTNER_DIRECTORY_MODULE ? new PartnerDirectoryModuleService() : undefined),
  }
  await GET({ query, scope } as unknown as RouteArgs[0], res as unknown as RouteArgs[1])
  return res
}

type Body = { partners: Array<Record<string, unknown>>; count: number; kinds: string[]; serves: string[] }

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
