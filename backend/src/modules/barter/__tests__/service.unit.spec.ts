import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import BarterModuleService from "../service"

const proto = BarterModuleService.prototype as any

describe("BarterModuleService", () => {
  describe("proposeBarter", () => {
    const ctx = () => ({
      createBarterProposals: jest.fn(async (rows: any[]) => [rows[0]]),
    })

    it("accepts a pool-targeted proposal", async () => {
      const c: any = ctx()
      const out = await proto.proposeBarter.call(c, {
        proposer_id: "cus_1",
        demand_post_id: "dp_1",
        offering: "3h plumbing",
        wanting: "a chest freezer",
      })

      expect(out.demand_post_id).toBe("dp_1")
      expect(out.bounty_id).toBeNull()
    })

    it("rejects a proposal targeting both a pool and a bounty", async () => {
      const c: any = ctx()

      // "Whoever accepts first" is not a rule anyone would choose on purpose.
      await expect(
        proto.proposeBarter.call(c, {
          proposer_id: "cus_1",
          demand_post_id: "dp_1",
          bounty_id: "bnt_1",
          offering: "x",
          wanting: "y",
        })
      ).rejects.toThrow(/exactly one/i)

      expect(c.createBarterProposals).not.toHaveBeenCalled()
    })

    it("rejects a proposal targeting neither", async () => {
      const c: any = ctx()

      await expect(
        proto.proposeBarter.call(c, {
          proposer_id: "cus_1",
          offering: "x",
          wanting: "y",
        })
      ).rejects.toThrow(/exactly one/i)
    })
  })

  describe("acceptBarter", () => {
    const makeCtx = (proposal: any, opts: { pg?: boolean } = {}) => {
      const raw = jest.fn(async () => ({ rows: [{ id: proposal?.id }] }))
      return {
        raw,
        listBarterProposals: jest.fn(async () => (proposal ? [proposal] : [])),
        updateBarterProposals: jest.fn(async (input: any) => {
          Object.assign(proposal, input)
          return proposal
        }),
        resolvePgConnection: () => (opts.pg ? { raw } : undefined),
      }
    }

    const proposed = (over: any = {}) => ({
      id: "bp_1",
      proposer_id: "cus_proposer",
      status: "PROPOSED",
      ...over,
    })

    it("refuses to let a proposer accept their own barter", async () => {
      const c: any = makeCtx(proposed())

      await expect(
        proto.acceptBarter.call(c, "bp_1", "cus_proposer")
      ).rejects.toThrow(/cannot accept their own/i)

      expect(c.updateBarterProposals).not.toHaveBeenCalled()
    })

    it("decides the race with a status = PROPOSED predicate", async () => {
      const c: any = makeCtx(proposed(), { pg: true })

      await proto.acceptBarter.call(c, "bp_1", "cus_accepter")

      const [sql, bindings] = c.raw.mock.calls[0]
      expect(sql).toContain("status = 'PROPOSED'")
      expect(bindings).toEqual(["cus_accepter", "bp_1"])
      expect(c.updateBarterProposals).not.toHaveBeenCalled()
    })

    it("loses the race gracefully", async () => {
      const c: any = makeCtx(proposed(), { pg: true })
      c.raw = jest.fn(async () => ({ rows: [] }))
      c.resolvePgConnection = () => ({ raw: c.raw })

      await expect(
        proto.acceptBarter.call(c, "bp_1", "cus_late")
      ).rejects.toThrow(/already been accepted/i)
    })

    it("refuses a proposal that is not open", async () => {
      const c: any = makeCtx(proposed({ status: "COMPLETED" }))

      await expect(
        proto.acceptBarter.call(c, "bp_1", "cus_accepter")
      ).rejects.toThrow(/cannot accept/i)
    })
  })

  describe("completeBarter", () => {
    it("records the audit entry id", async () => {
      const proposal: any = { id: "bp_1", status: "ACCEPTED" }
      const c: any = {
        listBarterProposals: jest.fn(async () => [proposal]),
        updateBarterProposals: jest.fn(async (input: any) => {
          Object.assign(proposal, input)
          return proposal
        }),
      }

      await proto.completeBarter.call(c, "bp_1", "le_9")

      expect(proposal.status).toBe("COMPLETED")
      expect(proposal.ledger_entry_id).toBe("le_9")
    })

    it("refuses to complete something never accepted", async () => {
      const c: any = {
        listBarterProposals: jest.fn(async () => [{ id: "bp_1", status: "PROPOSED" }]),
        updateBarterProposals: jest.fn(),
      }

      await expect(proto.completeBarter.call(c, "bp_1", null)).rejects.toThrow(
        /only an accepted proposal/i
      )
      expect(c.updateBarterProposals).not.toHaveBeenCalled()
    })
  })

  /**
   * Exercised rather than stubbed, because the identical helper shipped broken
   * in mutual-aid: it guessed the key `"pgConnection"` when the registration
   * key is `"__pg_connection__"`, so it always returned undefined and the
   * guarded UPDATE never ran — with every unit test green, because they all
   * stubbed it.
   */
  describe("resolvePgConnection", () => {
    const call = (container: unknown) =>
      proto.resolvePgConnection.call({ __container__: container })

    it("resolves through container.resolve with the framework key", () => {
      const conn = { raw: jest.fn() }
      const container = { resolve: jest.fn(() => conn) }

      expect(call(container)).toBe(conn)
      expect(container.resolve).toHaveBeenCalledWith(
        ContainerRegistrationKeys.PG_CONNECTION
      )
    })

    it("falls back to property access under the same key", () => {
      const conn = { raw: jest.fn() }
      expect(call({ [ContainerRegistrationKeys.PG_CONNECTION]: conn })).toBe(conn)
    })

    it("derives knex from the entity manager as a last resort", () => {
      const knex = { raw: jest.fn() }
      expect(
        call({ manager: { getConnection: () => ({ getKnex: () => knex }) } })
      ).toBe(knex)
    })

    it("returns undefined when nothing is reachable", () => {
      expect(call({})).toBeUndefined()
      expect(call(undefined)).toBeUndefined()
    })
  })
})
