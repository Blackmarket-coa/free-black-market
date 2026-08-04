import { POST } from "../storefronts/from-template/route"
import { TENANCY_MODULE } from "../../../../modules/tenancy"
import TenancyModuleService from "../../../../modules/tenancy/service"
import { gatesGrantedByTier } from "../../../../modules/tenancy/gates"

/**
 * Template provisioning has to end with the creator able to use what they just
 * created. It previously did not: no membership was written, and every tenancy
 * route on the new storefront 403s without one.
 */

const makeService = () => {
  const real = TenancyModuleService.prototype
  const createStorefronts = jest.fn(async (input: Record<string, unknown>) => ({
    id: "sf_new",
    ...input,
  }))
  const memberships: Record<string, unknown>[] = []
  const createMemberships = jest.fn(async (rows: Record<string, unknown>[]) => {
    memberships.push(...rows)
    return rows.map((r, i) => ({ id: `mem_${i}`, ...r }))
  })
  const listMemberships = jest.fn(async (filter: Record<string, unknown>) =>
    memberships.filter(
      (m) =>
        m.user_id === filter.user_id && m.storefront_id === filter.storefront_id
    )
  )
  const ensureOnboardingState = jest.fn(async () => ({ id: "onb_1" }))

  const service = {
    createStorefronts,
    createMemberships,
    listMemberships,
    ensureOnboardingState,
    starterTemplates: real.starterTemplates,
    starterTemplatesWithGates: real.starterTemplatesWithGates,
    ensureMembership: real.ensureMembership,
  }

  // The two real methods call `this` — bind them to the stub.
  service.starterTemplatesWithGates =
    real.starterTemplatesWithGates.bind(service)
  service.ensureMembership = real.ensureMembership.bind(service)

  return { service, createStorefronts, createMemberships, memberships }
}

const makeReq = (body: Record<string, unknown>, actor = "usr_1") => {
  const { service, ...spies } = makeService()
  const req = {
    body,
    auth_context: { actor_id: actor },
    scope: {
      resolve: (key: string) => (key === TENANCY_MODULE ? service : undefined),
    },
  }
  return { req, service, ...spies }
}

const makeRes = () => {
  const res: Record<string, unknown> = {}
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res
}

const BODY = {
  organization_id: "org_1",
  storefront_name: "Riverside Co-op",
  storefront_slug: "riverside",
  template_key: "food_coop",
}

describe("POST /admin/tenancy/storefronts/from-template", () => {
  it("makes the creator an owner of the storefront it just created", async () => {
    // The load-bearing case. Without this row, requireStorefrontContext 403s
    // the creator out of the storefront on their very next request.
    const { req, memberships } = makeReq(BODY)
    const res = makeRes()

    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({
      user_id: "usr_1",
      organization_id: "org_1",
      storefront_id: "sf_new",
      role: "org_owner",
    })
  })

  it("applies the template's tier to the storefront", async () => {
    const { req, createStorefronts } = makeReq(BODY)
    await POST(req as never, makeRes() as never)
    expect(createStorefronts).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "tier1_verified" })
    )
  })

  it("returns the gates the chosen tier grants", async () => {
    // Derived from the tier, not listed separately, so a template cannot
    // promise a capability its tier withholds.
    const { req } = makeReq({ ...BODY, template_key: "nonprofit_marketplace" })
    const res = makeRes()
    await POST(req as never, res as never)

    const body = res.body as { template: { gates: string[]; tier: string } }
    expect(body.template.tier).toBe("tier2_aligned_org")
    expect(body.template.gates).toEqual(gatesGrantedByTier("tier2_aligned_org"))
    expect(body.template.gates).toContain("ledger_batch_settlement")
  })

  it("does not duplicate the membership when the request is retried", async () => {
    const { req, memberships } = makeReq(BODY)
    await POST(req as never, makeRes() as never)
    await POST(req as never, makeRes() as never)
    expect(memberships).toHaveLength(1)
  })

  it("still provisions when there is no identifiable actor", async () => {
    // A machine-to-machine call has no user to make an owner. Provisioning the
    // storefront anyway is right — refusing would break an existing caller for
    // the sake of a row that call has no use for.
    const { req, memberships } = makeReq(BODY, "")
    const res = makeRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(memberships).toHaveLength(0)
    expect((res.body as { membership: unknown }).membership).toBeNull()
  })

  it("404s an unknown template without creating anything", async () => {
    const { req, createStorefronts, memberships } = makeReq({
      ...BODY,
      template_key: "not_a_template",
    })
    const res = makeRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(404)
    expect(createStorefronts).not.toHaveBeenCalled()
    expect(memberships).toHaveLength(0)
  })
})
