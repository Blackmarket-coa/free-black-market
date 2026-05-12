/**
 * ProjectInstance lifecycle tests.
 *
 * Two layers:
 *
 *   1. Pure functions (state machine + payload computation). These
 *      are the meaningful logic; the service-side orchestration is
 *      thin glue that calls them.
 *
 *   2. Service orchestration via a fake retrieve/list/create/update
 *      surface. Mirrors the seed.unit.spec.ts pattern — verifies
 *      that acceptProposal stitches together the right reads, the
 *      right state transitions, and the right writes.
 */

import {
  transitionProposalState,
  transitionInstanceState,
  computeInstancePayload,
  asManifestSlug,
  InvalidTransitionError,
  type ProposalState,
  type InstanceState,
} from "../instance-lifecycle"

describe("transitionProposalState", () => {
  it("pending → accepted via accept", () => {
    expect(transitionProposalState("pending", "accept")).toBe("accepted")
  })

  it("pending → declined via decline", () => {
    expect(transitionProposalState("pending", "decline")).toBe("declined")
  })

  it("pending → expired via expire", () => {
    expect(transitionProposalState("pending", "expire")).toBe("expired")
  })

  it.each<ProposalState>(["accepted", "declined", "expired"])(
    "throws on any action from terminal state %s",
    (state) => {
      expect(() => transitionProposalState(state, "accept")).toThrow(
        InvalidTransitionError
      )
      expect(() => transitionProposalState(state, "decline")).toThrow(
        InvalidTransitionError
      )
      expect(() => transitionProposalState(state, "expire")).toThrow(
        InvalidTransitionError
      )
    }
  )

  it("the InvalidTransitionError carries entity, from, and action", () => {
    try {
      transitionProposalState("accepted", "decline")
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError)
      const e = err as InvalidTransitionError
      expect(e.entity).toBe("proposal")
      expect(e.from).toBe("accepted")
      expect(e.action).toBe("decline")
    }
  })
})

describe("transitionInstanceState", () => {
  it("draft → active via publish", () => {
    expect(transitionInstanceState("draft", "publish")).toBe("active")
  })

  it("active → paused via pause", () => {
    expect(transitionInstanceState("active", "pause")).toBe("paused")
  })

  it("paused → active via reactivate", () => {
    expect(transitionInstanceState("paused", "reactivate")).toBe("active")
  })

  it.each<InstanceState>(["draft", "active", "paused"])(
    "%s → archived via archive",
    (state) => {
      expect(transitionInstanceState(state, "archive")).toBe("archived")
    }
  )

  it("archived is terminal — every action throws", () => {
    expect(() => transitionInstanceState("archived", "publish")).toThrow(
      InvalidTransitionError
    )
    expect(() => transitionInstanceState("archived", "pause")).toThrow(
      InvalidTransitionError
    )
    expect(() => transitionInstanceState("archived", "reactivate")).toThrow(
      InvalidTransitionError
    )
    expect(() => transitionInstanceState("archived", "archive")).toThrow(
      InvalidTransitionError
    )
  })

  it("active cannot publish (already past draft)", () => {
    expect(() => transitionInstanceState("active", "publish")).toThrow(
      InvalidTransitionError
    )
  })

  it("draft cannot pause (not yet active)", () => {
    expect(() => transitionInstanceState("draft", "pause")).toThrow(
      InvalidTransitionError
    )
  })

  it("active cannot reactivate (already active)", () => {
    expect(() => transitionInstanceState("active", "reactivate")).toThrow(
      InvalidTransitionError
    )
  })

  it("paused cannot pause (already paused)", () => {
    expect(() => transitionInstanceState("paused", "pause")).toThrow(
      InvalidTransitionError
    )
  })
})

describe("computeInstancePayload", () => {
  it("operator member is always in member_ids even with no other declarations", () => {
    const payload = computeInstancePayload(
      {
        manifest_slug: "yard-scrap-nursery",
        member_id: "mem_op",
        declaration_ids: [],
      },
      []
    )
    expect(payload.member_ids).toEqual(["mem_op"])
  })

  it("member_ids is the deduplicated, sorted union of operator + declaration owners", () => {
    const payload = computeInstancePayload(
      {
        manifest_slug: "yard-scrap-nursery",
        member_id: "mem_op",
        declaration_ids: ["d1", "d2", "d3", "d4"],
      },
      [
        { id: "d1", member_id: "mem_op" }, // operator's own
        { id: "d2", member_id: "mem_household_b" },
        { id: "d3", member_id: "mem_household_a" },
        { id: "d4", member_id: "mem_household_b" }, // duplicate household
        { id: "d_extra", member_id: "mem_outside" }, // not in declaration_ids
      ]
    )
    expect(payload.member_ids).toEqual([
      "mem_household_a",
      "mem_household_b",
      "mem_op",
    ])
  })

  it("ignores declarations whose id is not in proposal.declaration_ids", () => {
    const payload = computeInstancePayload(
      {
        manifest_slug: "tool-library",
        member_id: "mem_lib",
        declaration_ids: ["d_lib"],
      },
      [
        { id: "d_lib", member_id: "mem_lib" },
        { id: "d_other", member_id: "mem_outside" },
      ]
    )
    expect(payload.member_ids).toEqual(["mem_lib"])
  })

  it("preserves manifest_slug and operator_member_id verbatim", () => {
    const payload = computeInstancePayload(
      {
        manifest_slug: "repair-cafe",
        member_id: "mem_coord",
        declaration_ids: ["d_venue"],
      },
      [{ id: "d_venue", member_id: "mem_venue" }]
    )
    expect(payload.manifest_slug).toBe("repair-cafe")
    expect(payload.operator_member_id).toBe("mem_coord")
  })

  it("defaults state to active", () => {
    const payload = computeInstancePayload(
      {
        manifest_slug: "yard-scrap-nursery",
        member_id: "mem_op",
        declaration_ids: [],
      },
      []
    )
    expect(payload.state).toBe("active")
  })

  it("respects state: 'draft' for staged instances", () => {
    const payload = computeInstancePayload(
      {
        manifest_slug: "yard-scrap-nursery",
        member_id: "mem_op",
        declaration_ids: [],
      },
      [],
      { state: "draft" }
    )
    expect(payload.state).toBe("draft")
  })
})

describe("asManifestSlug", () => {
  it("returns the slug when known", () => {
    expect(asManifestSlug("tool-library", ["yard-scrap-nursery", "tool-library"])).toBe(
      "tool-library"
    )
  })

  it("throws when the slug is not in the catalog", () => {
    expect(() => asManifestSlug("ghost-vertical", ["tool-library"])).toThrow(
      /unknown manifest slug/
    )
  })
})

// ── service orchestration via a fake DB surface ─────────────────────

import AssetGraphService from "../service"

const buildFakeService = (
  fixtures: {
    proposals?: Record<string, any>
    instances?: Record<string, any>
    declarations?: Array<{ id: string; member_id: string }>
  } = {}
) => {
  const proposalRows: Record<string, any> = { ...(fixtures.proposals ?? {}) }
  const instanceRows: Record<string, any> = { ...(fixtures.instances ?? {}) }
  const declarationRows: Array<{ id: string; member_id: string }> =
    fixtures.declarations ?? []
  const calls: Array<{ method: string; args: unknown }> = []

  const inst = Object.create(AssetGraphService.prototype)

  inst.retrieveMatchProposal = jest.fn(async (id: string) => {
    calls.push({ method: "retrieveMatchProposal", args: id })
    const row = proposalRows[id]
    if (!row) throw new Error(`No proposal ${id}`)
    return row
  })
  inst.updateMatchProposals = jest.fn(async (payload: any) => {
    calls.push({ method: "updateMatchProposals", args: payload })
    proposalRows[payload.id] = { ...proposalRows[payload.id], ...payload }
    return proposalRows[payload.id]
  })
  inst.retrieveProjectInstance = jest.fn(async (id: string) => {
    calls.push({ method: "retrieveProjectInstance", args: id })
    const row = instanceRows[id]
    if (!row) throw new Error(`No instance ${id}`)
    return row
  })
  inst.updateProjectInstances = jest.fn(async (payload: any) => {
    calls.push({ method: "updateProjectInstances", args: payload })
    instanceRows[payload.id] = { ...instanceRows[payload.id], ...payload }
    return instanceRows[payload.id]
  })
  inst.createProjectInstances = jest.fn(async (payload: any) => {
    calls.push({ method: "createProjectInstances", args: payload })
    const row = { id: `pi_${Object.keys(instanceRows).length + 1}`, ...payload }
    instanceRows[row.id] = row
    return row
  })
  inst.listAssetDeclarations = jest.fn(async (filter: any) => {
    calls.push({ method: "listAssetDeclarations", args: filter })
    if (filter && Array.isArray(filter.id)) {
      const wanted = new Set(filter.id)
      return declarationRows.filter((d) => wanted.has(d.id))
    }
    return declarationRows
  })

  return { service: inst as AssetGraphService, calls }
}

describe("acceptProposal (service orchestration)", () => {
  it("creates an instance + marks proposal accepted on the happy path", async () => {
    const { service, calls } = buildFakeService({
      proposals: {
        prop_1: {
          id: "prop_1",
          manifest_slug: "yard-scrap-nursery",
          member_id: "mem_op",
          declaration_ids: ["d_op", "d_household"],
          state: "pending",
        },
      },
      declarations: [
        { id: "d_op", member_id: "mem_op" },
        { id: "d_household", member_id: "mem_household" },
      ],
    })

    const { proposal, instance } = await service.acceptProposal({
      proposal_id: "prop_1",
    })

    expect(proposal.state).toBe("accepted")
    expect(proposal.resolved_at).toBeInstanceOf(Date)

    expect(instance.manifest_slug).toBe("yard-scrap-nursery")
    expect(instance.operator_member_id).toBe("mem_op")
    expect(instance.member_ids).toEqual(["mem_household", "mem_op"])
    expect(instance.state).toBe("active")

    // The orchestration order: retrieve proposal → list decls → create instance → update proposal.
    const methods = calls.map((c) => c.method)
    expect(methods).toEqual([
      "retrieveMatchProposal",
      "listAssetDeclarations",
      "createProjectInstances",
      "updateMatchProposals",
    ])
  })

  it("respects state: 'draft' to stage an instance", async () => {
    const { service } = buildFakeService({
      proposals: {
        prop_1: {
          id: "prop_1",
          manifest_slug: "tool-library",
          member_id: "mem_lib",
          declaration_ids: [],
          state: "pending",
        },
      },
    })
    const { instance } = await service.acceptProposal({
      proposal_id: "prop_1",
      state: "draft",
    })
    expect(instance.state).toBe("draft")
  })

  it("throws InvalidTransitionError when the proposal is already accepted", async () => {
    const { service } = buildFakeService({
      proposals: {
        prop_1: {
          id: "prop_1",
          manifest_slug: "tool-library",
          member_id: "mem_lib",
          declaration_ids: [],
          state: "accepted",
        },
      },
    })
    await expect(
      service.acceptProposal({ proposal_id: "prop_1" })
    ).rejects.toBeInstanceOf(InvalidTransitionError)
  })

  it("throws InvalidTransitionError when the proposal is declined", async () => {
    const { service } = buildFakeService({
      proposals: {
        prop_1: {
          id: "prop_1",
          manifest_slug: "tool-library",
          member_id: "mem_lib",
          declaration_ids: [],
          state: "declined",
        },
      },
    })
    await expect(
      service.acceptProposal({ proposal_id: "prop_1" })
    ).rejects.toBeInstanceOf(InvalidTransitionError)
  })
})

describe("declineProposal", () => {
  it("marks pending proposals as declined and stamps resolved_at", async () => {
    const { service } = buildFakeService({
      proposals: {
        prop_1: {
          id: "prop_1",
          manifest_slug: "tool-library",
          member_id: "mem_lib",
          declaration_ids: [],
          state: "pending",
        },
      },
    })
    const proposal = await service.declineProposal({ proposal_id: "prop_1" })
    expect(proposal.state).toBe("declined")
    expect(proposal.resolved_at).toBeInstanceOf(Date)
  })

  it("throws on non-pending proposals", async () => {
    const { service } = buildFakeService({
      proposals: {
        prop_1: {
          id: "prop_1",
          manifest_slug: "tool-library",
          member_id: "mem_lib",
          declaration_ids: [],
          state: "accepted",
        },
      },
    })
    await expect(
      service.declineProposal({ proposal_id: "prop_1" })
    ).rejects.toBeInstanceOf(InvalidTransitionError)
  })
})

describe("instance state-transition methods", () => {
  it("publishInstance: draft → active", async () => {
    const { service } = buildFakeService({
      instances: { pi_1: { id: "pi_1", state: "draft" } },
    })
    const result = await service.publishInstance({ instance_id: "pi_1" })
    expect(result.state).toBe("active")
  })

  it("pauseInstance: active → paused", async () => {
    const { service } = buildFakeService({
      instances: { pi_1: { id: "pi_1", state: "active" } },
    })
    const result = await service.pauseInstance({ instance_id: "pi_1" })
    expect(result.state).toBe("paused")
  })

  it("reactivateInstance: paused → active", async () => {
    const { service } = buildFakeService({
      instances: { pi_1: { id: "pi_1", state: "paused" } },
    })
    const result = await service.reactivateInstance({ instance_id: "pi_1" })
    expect(result.state).toBe("active")
  })

  it("archiveInstance: active → archived", async () => {
    const { service } = buildFakeService({
      instances: { pi_1: { id: "pi_1", state: "active" } },
    })
    const result = await service.archiveInstance({ instance_id: "pi_1" })
    expect(result.state).toBe("archived")
  })

  it("archiveInstance also works from draft and paused", async () => {
    for (const startState of ["draft", "paused"] as const) {
      const { service } = buildFakeService({
        instances: { pi_1: { id: "pi_1", state: startState } },
      })
      const result = await service.archiveInstance({ instance_id: "pi_1" })
      expect(result.state).toBe("archived")
    }
  })

  it("any transition from archived throws", async () => {
    for (const action of ["publish", "pause", "reactivate", "archive"] as const) {
      const { service } = buildFakeService({
        instances: { pi_1: { id: "pi_1", state: "archived" } },
      })
      const method =
        action === "publish"
          ? service.publishInstance
          : action === "pause"
          ? service.pauseInstance
          : action === "reactivate"
          ? service.reactivateInstance
          : service.archiveInstance
      await expect(
        method.call(service, { instance_id: "pi_1" })
      ).rejects.toBeInstanceOf(InvalidTransitionError)
    }
  })
})
