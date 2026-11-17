import { GET as listProposals } from "../proposals/route"
import { GET as listBounties } from "../bounties/route"
import { GET as listTrades } from "../barter/route"
import { DEMAND_POOL_MODULE } from "../../../../../../modules/demand-pool"
import { BARTER_MODULE } from "../../../../../../modules/barter"

/**
 * Who reads a demand pool's proposals, bounties and trades, and how much of
 * each (SD-118 follow-up, `../_pool-readers.ts`). The Postgres cases are in
 * `integration-tests/http/store-public-fields.spec.ts`; these pin each
 * branch of the rule against stub services that refuse any key but the two
 * module constants.
 */

type Row = Record<string, unknown>

const CREATOR = "cus_creator"
const PARTICIPANT = "cus_participant"
const CONTRIBUTOR = "cus_contributor"
const ASSIGNEE = "cus_assignee"
const PROPOSER = "cus_proposer"
const STRANGER = "cus_stranger"

const proposal: Row = {
  id: "prop_1",
  demand_post_id: "dp_1",
  supplier_id: "sel_supplier",
  unit_price: 12,
  currency_code: "USD",
  min_quantity: 10,
  max_quantity: 60,
  volume_tiers: null,
  fulfillment_timeline_days: 14,
  delivery_method: "pallet freight",
  delivery_cost: 40,
  certifications: ["organic"],
  compliance_notes: "compliance-private",
  payment_terms: "terms-private",
  notes: "notes-private",
  counter_offer: { notes: "counter-private" },
  counter_offer_at: null,
  votes_for: 2,
  votes_against: 1,
  vote_weight_for: 2,
  vote_weight_against: 1,
  status: "SUBMITTED",
  submitted_at: "2026-11-16T00:00:00.000Z",
  reviewed_at: null,
  metadata: { internal: "metadata-private" },
  raw_unit_price: { value: "12", precision: 20 },
  created_at: "2026-11-16T00:00:00.000Z",
}

const openBounty: Row = {
  id: "bounty_open",
  demand_post_id: "dp_1",
  contributor_id: CONTRIBUTOR,
  contributor_type: "CUSTOMER",
  objective: "FIND_SUPPLIER",
  amount: 25,
  currency_code: "USD",
  escrowed: true,
  escrow_ledger_entry_id: "escrow-private",
  milestones: [{ description: "Supplier named", percentage: 100, condition: "a quote", completed: false, proof: "proof-private" }],
  milestones_completed: 0,
  amount_paid_out: 0,
  assignee_id: ASSIGNEE,
  assignee_type: "CUSTOMER",
  status: "ACTIVE",
  visibility: "PUBLIC",
  metadata: { proofs: ["metadata-private"] },
}

const restrictedBounty: Row = {
  ...openBounty,
  id: "bounty_restricted",
  contributor_id: CREATOR,
  assignee_id: null,
  visibility: "RESTRICTED",
}

const trade: Row = {
  id: "trade_1",
  demand_post_id: "dp_1",
  bounty_id: null,
  proposer_id: PROPOSER,
  offering: "two hours of hauling",
  wanting: "one sack",
  estimated_hours: 2,
  status: "ACCEPTED",
  accepted_by: CREATOR,
  accepted_at: "2026-11-16T00:00:00.000Z",
  completed_at: null,
  ledger_entry_id: "ledger-private",
  metadata: { note: "metadata-private" },
}

const PRIVATE_VALUES = [
  "sel_supplier",
  "compliance-private",
  "terms-private",
  "notes-private",
  "counter-private",
  "metadata-private",
  "escrow-private",
  "proof-private",
  "ledger-private",
  CREATOR,
  CONTRIBUTOR,
  ASSIGNEE,
  PROPOSER,
]
const privateIn = (data: unknown) => PRIVATE_VALUES.filter((value) => JSON.stringify(data).includes(value))

function makeScope(pool: { visibility?: string; exists?: boolean } = {}) {
  const demandPool = {
    listDemandPosts: jest.fn(async () =>
      pool.exists === false ? [] : [{ id: "dp_1", creator_id: CREATOR, visibility: pool.visibility ?? "PUBLIC" }]
    ),
    listDemandParticipants: jest.fn(async (filters: { customer_id?: string }) =>
      [PARTICIPANT, CONTRIBUTOR].includes(filters.customer_id ?? "") ? [{ id: "part_1", customer_id: filters.customer_id }] : []
    ),
    listSupplierProposals: jest.fn(async () => [proposal]),
    listDemandBounties: jest.fn(async () => [openBounty, restrictedBounty]),
  }
  const barter = { listBarterProposals: jest.fn(async () => [trade]) }
  const scope = {
    resolve: (key: string) => {
      if (key === DEMAND_POOL_MODULE) return demandPool
      if (key === BARTER_MODULE) return barter
      throw new Error(`Unexpected resolve: ${key}`)
    },
  }
  return { scope, demandPool, barter }
}

const makeRes = () => {
  const res: { statusCode: number; body: any; status: (code: number) => any; json: (payload: unknown) => any } = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const call = async (
  handler: (req: any, res: any) => Promise<unknown>,
  caller: string | null,
  pool: { visibility?: string; exists?: boolean } = {}
) => {
  const { scope, demandPool } = makeScope(pool)
  const res = makeRes()
  await handler({ params: { id: "dp_1" }, auth_context: caller ? { actor_id: caller, actor_type: "customer" } : undefined, scope }, res)
  return { res, demandPool }
}

const NOT_FOUND = { error: "Demand pool not found" }
const handlers = [
  ["proposals", listProposals],
  ["bounties", listBounties],
  ["barter", listTrades],
] as const

describe("a demand pool's rows: proposals, bounties and trades", () => {
  it("anyone on a public pool reads the terms of each row, and no person, note, term, entry or metadata", async () => {
    for (const caller of [null, STRANGER, PARTICIPANT]) {
      const proposals = (await call(listProposals, caller)).res.body.proposals
      expect(proposals).toEqual([
        {
          id: "prop_1",
          demand_post_id: "dp_1",
          status: "SUBMITTED",
          unit_price: 12,
          currency_code: "USD",
          min_quantity: 10,
          max_quantity: 60,
          volume_tiers: null,
          fulfillment_timeline_days: 14,
          delivery_method: "pallet freight",
          delivery_cost: 40,
          certifications: ["organic"],
          votes_for: 2,
          votes_against: 1,
          vote_weight_for: 2,
          vote_weight_against: 1,
          submitted_at: "2026-11-16T00:00:00.000Z",
        },
      ])
      const bounties = (await call(listBounties, caller)).res.body.bounties
      // The restricted bounty stays hidden from them, as before.
      expect(bounties).toEqual([
        {
          id: "bounty_open",
          demand_post_id: "dp_1",
          objective: "FIND_SUPPLIER",
          amount: 25,
          currency_code: "USD",
          milestones: [{ description: "Supplier named", percentage: 100, condition: "a quote", completed: false }],
          milestones_completed: 0,
          status: "ACTIVE",
          visibility: "PUBLIC",
        },
      ])
      const trades = (await call(listTrades, caller)).res.body
      expect(trades).toEqual({
        proposals: [{ id: "trade_1", demand_post_id: "dp_1", offering: "two hours of hauling", wanting: "one sack", estimated_hours: 2, status: "ACCEPTED" }],
        count: 1,
      })
      expect([caller, privateIn([proposals, bounties, trades])]).toEqual([caller, []])
    }
  })

  it("the creator reads every row whole, the restricted bounty included", async () => {
    expect((await call(listProposals, CREATOR)).res.body.proposals).toEqual([proposal])
    expect((await call(listBounties, CREATOR)).res.body.bounties).toEqual([openBounty, restrictedBounty])
    expect((await call(listTrades, CREATOR)).res.body).toEqual({ proposals: [trade], count: 1 })
  })

  it("a bounty's contributor and assignee, and a trade's proposer, read their own row whole and the rest as terms", async () => {
    for (const caller of [CONTRIBUTOR, ASSIGNEE]) {
      const { body } = (await call(listBounties, caller)).res
      expect([caller, body.bounties]).toEqual([caller, [openBounty]])
      expect(privateIn((await call(listProposals, caller)).res.body)).toEqual([])
      expect(privateIn((await call(listTrades, caller)).res.body)).toEqual([])
    }
    expect((await call(listTrades, PROPOSER)).res.body).toEqual({ proposals: [trade], count: 1 })
    expect(privateIn((await call(listBounties, PROPOSER)).res.body)).toEqual([])
  })

  it("a pool that is not public is a missing pool to anyone who is neither its creator, a participant, nor on a row", async () => {
    for (const visibility of ["INVITE_ONLY", "NETWORK_ONLY"]) {
      for (const [name, handler] of handlers) {
        for (const caller of [null, STRANGER]) {
          const { res } = await call(handler, caller, { visibility })
          expect([visibility, name, caller, res.statusCode, res.body]).toEqual([visibility, name, caller, 404, NOT_FOUND])
        }
        // A participant reads the terms.
        const { res } = await call(handler, PARTICIPANT, { visibility })
        expect([visibility, name, res.statusCode, privateIn(res.body)]).toEqual([visibility, name, 200, []])
      }
    }
  })

  it("someone outside a pool that is not public who is on a row reads that row alone", async () => {
    const claimed = (await call(listBounties, ASSIGNEE, { visibility: "INVITE_ONLY" })).res
    expect([claimed.statusCode, claimed.body]).toEqual([200, { bounties: [openBounty] }])
    const offered = (await call(listTrades, PROPOSER, { visibility: "INVITE_ONLY" })).res
    expect([offered.statusCode, offered.body]).toEqual([200, { proposals: [trade], count: 1 }])
    for (const [caller, handler] of [
      [ASSIGNEE, listProposals],
      [ASSIGNEE, listTrades],
      [PROPOSER, listProposals],
      [PROPOSER, listBounties],
    ] as const) {
      const { res } = await call(handler, caller, { visibility: "INVITE_ONLY" })
      expect([caller, res.statusCode, res.body]).toEqual([caller, 404, NOT_FOUND])
    }
  })

  it("an id that names no pool is answered 404, with the body a refused pool gets", async () => {
    for (const [name, handler] of handlers) {
      for (const caller of [null, CREATOR]) {
        const { res } = await call(handler, caller, { exists: false })
        expect([name, caller, res.statusCode, res.body]).toEqual([name, caller, 404, NOT_FOUND])
      }
    }
  })

  it("asks who participates only when the pool is not public and the caller is not its creator", async () => {
    expect((await call(listProposals, STRANGER)).demandPool.listDemandParticipants).not.toHaveBeenCalled()
    expect((await call(listProposals, CREATOR, { visibility: "INVITE_ONLY" })).demandPool.listDemandParticipants).not.toHaveBeenCalled()
    expect((await call(listProposals, null, { visibility: "INVITE_ONLY" })).demandPool.listDemandParticipants).not.toHaveBeenCalled()
    const asked = (await call(listProposals, STRANGER, { visibility: "INVITE_ONLY" })).demandPool.listDemandParticipants
    expect(asked).toHaveBeenCalledWith({ demand_post_id: "dp_1", customer_id: STRANGER })
  })
})
