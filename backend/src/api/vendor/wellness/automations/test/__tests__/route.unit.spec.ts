import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const runTrigger = jest.fn(async () => ({ sent: 1, skipped: 0 }))
jest.mock("../../../../../../modules/wellness/automation-service", () => ({
  WellnessAutomationService: jest.fn().mockImplementation(() => ({ runTrigger })),
}))

import { POST } from "../route"

/**
 * POST /vendor/wellness/automations/test renders the seller's own template
 * with `vars` from the request and sends it; its email fallback really
 * sends now that the `wellness-automation` template exists. So the recipient
 * is restricted to an address the seller has proven they control: otherwise
 * any seller can mail any text to any address from FBM's domain.
 *
 * Every list the seller can write is refused: wellness clients and members
 * (`POST /vendor/wellness/clients` takes any address), the store's profile
 * `email` (`POST /vendor/sellers/me` copies it with no verification; today
 * only a validator bug stops that write), and a member who joined through an
 * invite (the inviting seller can read the invite token, so accepting it
 * proves nothing about the invited address; today acceptance is broken).
 *
 * The container resolves only the keys the route should use, by constant. The
 * wellness module is not among them: the route must not consult the lists a
 * seller writes, and resolving it fails the case.
 */

const SELLER_ROW = {
  // The store's profile address. The seller edits it; nothing verifies it.
  email: "profile@anywhere.example",
  members: [
    // Created with the seller from its registration.
    { email: "Owner@Farm.example" },
    // Created by accepting an invite.
    { email: "teammate@elsewhere.example" },
    { email: null },
  ],
  invites: [
    { email: "Teammate@Elsewhere.example", accepted: true },
    { email: "pending@elsewhere.example", accepted: false },
  ],
}

function harness() {
  const graph = jest.fn(async () => ({ data: [SELLER_ROW] }))
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
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
  return { scope, res, graph }
}

async function send(recipient: string) {
  const h = harness()
  const req = {
    scope: h.scope,
    _seller_id: "sel_1", _sellerContextResolved: true, auth_context: { actor_id: "sel_1", actor_type: "seller" },
    headers: {},
    body: { trigger: "booking_reminder", recipient_email: recipient, vars: { name: "Sam" } },
  }
  await POST(req as never, h.res as never)
  return h
}

beforeEach(() => runTrigger.mockClear())

describe("POST /vendor/wellness/automations/test: who a test may go to", () => {
  it("refuses an address that is not the seller's, and sends nothing", async () => {
    const h = await send("stranger@example.com")
    expect(h.res.statusCode).toBe(403)
    expect(h.res.body).toMatchObject({ type: "not_allowed" })
    expect(runTrigger).not.toHaveBeenCalled()
  })

  it("sends to the address the store was registered with, whatever its case", async () => {
    const h = await send("  owner@farm.EXAMPLE ")
    expect(h.res.statusCode).toBe(200)
    expect(runTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ seller_id: "sel_1", recipients: [{ email: "owner@farm.EXAMPLE", name: null }] })
    )
    expect(h.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "seller", filters: { id: "sel_1" } })
    )
  })

  it("refuses the store's profile email: the seller can set it to any address", async () => {
    // POST /vendor/sellers/me copies `email` into the seller row with no
    // verification. Only Medusa's `.strict()` on its body schema stops that
    // today, by accident; the vendor panel's store form already sends it.
    const h = await send("profile@anywhere.example")
    expect(h.res.statusCode).toBe(403)
    expect(runTrigger).not.toHaveBeenCalled()
  })

  it("refuses a member who joined through an invite: the inviter can read the token", async () => {
    // Mercur creates the member with the invite's address, whoever accepts.
    // POST /vendor/invites?fields=token hands the token to the inviter, so a
    // seller could accept their own invite and make any address "the team".
    const h = await send("TEAMMATE@elsewhere.example")
    expect(h.res.statusCode).toBe(403)
    expect(runTrigger).not.toHaveBeenCalled()
  })

  it("refuses an address that only has a pending invite", async () => {
    const h = await send("pending@elsewhere.example")
    expect(h.res.statusCode).toBe(403)
    expect(runTrigger).not.toHaveBeenCalled()
  })

  it("refuses a wellness client or member: the seller writes those lists and can add anyone", async () => {
    // Before, a seller could POST /vendor/wellness/clients with a stranger's
    // address and then test-send to it. The harness has no wellness module,
    // so a route that looked the address up there would throw, not pass.
    for (const address of ["client@example.com", "member@example.com"]) {
      const h = await send(address)
      expect(h.res.statusCode).toBe(403)
    }
    expect(runTrigger).not.toHaveBeenCalled()
  })

  it("still answers 400 without a recipient", async () => {
    const h = await send("")
    expect(h.res.statusCode).toBe(400)
    expect(runTrigger).not.toHaveBeenCalled()
  })
})
