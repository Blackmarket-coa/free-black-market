import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { WELLNESS_MODULE } from "../../../../../../modules/wellness"

const runTrigger = jest.fn(async () => ({ sent: 1, skipped: 0 }))
jest.mock("../../../../../../modules/wellness/automation-service", () => ({
  WellnessAutomationService: jest.fn().mockImplementation(() => ({ runTrigger })),
}))

import { POST } from "../route"

/**
 * POST /vendor/wellness/automations/test renders the seller's own template
 * with `vars` from the request and sends it; its email fallback really
 * sends now that the `wellness-automation` template exists. So the recipient
 * is restricted to the seller, their team, or their own clients and members:
 * otherwise any seller can mail any text to any address from FBM's domain.
 *
 * The container resolves only the keys the route should use, by constant.
 */

type Filter = { seller_id: string; email: string[] }

function harness(opts: { clients?: string[]; members?: string[] } = {}) {
  const graph = jest.fn(async () => ({
    data: [{ email: "owner@farm.example", members: [{ email: "Staff@Farm.example" }, { email: null }] }],
  }))
  const matches = (rows: string[] | undefined) => (filter: Filter) =>
    (rows ?? []).some((e) => filter.email.includes(e)) ? [{ id: "row_1" }] : []
  const listClientProfiles = jest.fn(async (filter: Filter) => matches(opts.clients)(filter))
  const listMembers = jest.fn(async (filter: Filter) => matches(opts.members)(filter))
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    [WELLNESS_MODULE]: { listClientProfiles, listMembers },
    // requireSellerId resolves these eagerly; a `sel_` actor needs neither.
    [ContainerRegistrationKeys.PG_CONNECTION]: { raw: jest.fn() },
    [Modules.AUTH]: { listAuthIdentities: jest.fn(async () => []) },
  }
  const scope = {
    resolve(key: string) {
      if (!(key in services)) throw new Error(`unexpected container key in spec: ${key}`)
      return services[key]
    },
  }
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return { scope, res, graph, listClientProfiles, listMembers }
}

async function send(recipient: string, opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts)
  const req = {
    scope: h.scope,
    auth_context: { actor_id: "sel_1", actor_type: "seller" },
    headers: {},
    body: { trigger: "booking_reminder", recipient_email: recipient, vars: { name: "Sam" } },
  }
  await POST(req as never, h.res as never)
  return h
}

beforeEach(() => runTrigger.mockClear())

describe("POST /vendor/wellness/automations/test: who a test may go to", () => {
  it("refuses an address that is not the seller's, their team's or a client's, and sends nothing", async () => {
    const h = await send("stranger@example.com")
    expect(h.res.statusCode).toBe(403)
    expect(h.res.body).toMatchObject({ type: "not_allowed" })
    expect(runTrigger).not.toHaveBeenCalled()
    // Clients and members were looked up within this seller only.
    expect(h.listClientProfiles).toHaveBeenCalledWith(
      { seller_id: "sel_1", email: ["stranger@example.com"] },
      expect.anything()
    )
    expect(h.listMembers).toHaveBeenCalledWith({ seller_id: "sel_1", email: ["stranger@example.com"] }, expect.anything())
  })

  it("sends to the seller's own address, whatever its case", async () => {
    const h = await send("  Owner@Farm.Example ")
    expect(h.res.statusCode).toBe(200)
    expect(runTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ seller_id: "sel_1", recipients: [{ email: "Owner@Farm.Example", name: null }] })
    )
    expect(h.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "seller", filters: { id: "sel_1" } })
    )
  })

  it("sends to a member of the seller's team", async () => {
    await send("staff@farm.example")
    expect(runTrigger).toHaveBeenCalledTimes(1)
  })

  it("sends to one of the seller's clients, matching the stored spelling or its lower case", async () => {
    const h = await send("Client@Example.com", { clients: ["client@example.com"] })
    expect(h.res.statusCode).toBe(200)
    expect(h.listClientProfiles).toHaveBeenCalledWith(
      { seller_id: "sel_1", email: ["Client@Example.com", "client@example.com"] },
      expect.anything()
    )
    expect(runTrigger).toHaveBeenCalledTimes(1)
  })

  it("sends to one of the seller's wellness members", async () => {
    await send("member@example.com", { members: ["member@example.com"] })
    expect(runTrigger).toHaveBeenCalledTimes(1)
  })

  it("still answers 400 without a recipient", async () => {
    const h = await send("")
    expect(h.res.statusCode).toBe(400)
    expect(runTrigger).not.toHaveBeenCalled()
  })
})
