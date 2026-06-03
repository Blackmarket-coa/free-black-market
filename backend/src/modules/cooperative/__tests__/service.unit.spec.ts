import CooperativeService from "../service"
import { CooperativeMemberRole } from "../models/cooperative-member"

/**
 * Unit tests for the self-service coalition membership methods added to
 * CooperativeService. We build a fake instance (no Medusa DI) and stub the
 * auto-CRUD surface the domain methods call, mirroring the hawala-ledger
 * test style.
 */
function buildService(initialMembers: any[] = []) {
  const svc: any = Object.create(CooperativeService.prototype)
  const members = [...initialMembers]
  let seq = members.length

  svc.listCooperativeMembers = jest.fn(async (filter: any = {}) =>
    members.filter((m) =>
      Object.entries(filter).every(([k, v]) => m[k] === v)
    )
  )
  svc.createCooperativeMembers = jest.fn(async (data: any) => {
    const created = { id: `mem-${++seq}`, ...data }
    members.push(created)
    return created
  })
  svc.updateCooperativeMembers = jest.fn(async (updates: any[]) =>
    updates.map((u) => {
      const m = members.find((x) => x.id === u.id)
      Object.assign(m, u)
      return m
    })
  )

  return { svc, members }
}

describe("CooperativeService membership", () => {
  const base = { cooperative_id: "coop-1", producer_id: "cus-1" }

  it("joinCooperative creates a new active MEMBER when none exists", async () => {
    const { svc } = buildService()

    const member = await svc.joinCooperative(base)

    expect(svc.createCooperativeMembers).toHaveBeenCalledTimes(1)
    expect(member.cooperative_id).toBe("coop-1")
    expect(member.producer_id).toBe("cus-1")
    expect(member.role).toBe(CooperativeMemberRole.MEMBER)
    expect(member.is_active).toBe(true)
  })

  it("joinCooperative is idempotent — returns existing active membership without creating", async () => {
    const existing = { id: "mem-1", ...base, role: "MEMBER", is_active: true }
    const { svc } = buildService([existing])

    const member = await svc.joinCooperative(base)

    expect(member).toBe(existing)
    expect(svc.createCooperativeMembers).not.toHaveBeenCalled()
  })

  it("joinCooperative reactivates a previously-left membership instead of duplicating", async () => {
    const left = { id: "mem-1", ...base, role: "MEMBER", is_active: false }
    const { svc, members } = buildService([left])

    const member = await svc.joinCooperative(base)

    expect(svc.createCooperativeMembers).not.toHaveBeenCalled()
    expect(svc.updateCooperativeMembers).toHaveBeenCalledTimes(1)
    expect(member.is_active).toBe(true)
    expect(members).toHaveLength(1) // no duplicate row
  })

  it("leaveCooperative soft-deactivates an active membership", async () => {
    const active = { id: "mem-1", ...base, is_active: true }
    const { svc } = buildService([active])

    const result = await svc.leaveCooperative(base)

    expect(result).toEqual({ left: true })
    expect(active.is_active).toBe(false)
  })

  it("leaveCooperative is a no-op when not a member", async () => {
    const { svc } = buildService([])

    const result = await svc.leaveCooperative(base)

    expect(result).toEqual({ left: false })
    expect(svc.updateCooperativeMembers).not.toHaveBeenCalled()
  })

  it("listActiveMembers filters to active members", async () => {
    const { svc } = buildService([
      { id: "mem-1", cooperative_id: "coop-1", producer_id: "a", is_active: true },
      { id: "mem-2", cooperative_id: "coop-1", producer_id: "b", is_active: false },
    ])

    const active = await svc.listActiveMembers("coop-1")

    expect(active).toHaveLength(1)
    expect(active[0].producer_id).toBe("a")
  })
})
