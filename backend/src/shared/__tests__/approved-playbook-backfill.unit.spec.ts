import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const mockRun = jest.fn()
jest.mock("../../workflows/assign-playbook", () => ({
  ...jest.requireActual("../../workflows/assign-playbook"),
  assignPlaybookWorkflow: () => ({ run: mockRun }),
}))
const mockResolveLinkedStore = jest.fn()
const mockIsUnfinishedApprovalOf = jest.fn()
jest.mock("../linked-store", () => ({
  resolveLinkedStore: (...args: unknown[]) => mockResolveLinkedStore(...args),
  isUnfinishedApprovalOf: (...args: unknown[]) => mockIsUnfinishedApprovalOf(...args),
}))

import { backfillApprovedSellerPlaybooks } from "../approved-playbook-backfill"
import { REQUEST_MODULE } from "../../modules/request"
import { PLAYBOOK_MODULE } from "../../modules/playbook"

/**
 * The refusals of the backfill for sellers approved while the playbook
 * registry was empty. The path that writes is pinned on Postgres by
 * integration-tests/http/vendor-onboarding-journey.spec.ts.
 */
describe("backfillApprovedSellerPlaybooks", () => {
  const request = {
    id: "req_1",
    type: "seller",
    status: "accepted",
    submitter_id: "authid_1",
    data: {
      auth_identity_id: "authid_1",
      member: { name: "Alpha", email: "alpha@example.com" },
      seller: { name: "Alpha Kitchen" },
      vendor_type: "maker",
      playbook: "stall",
      roles: ["stall", "kitchen"],
      recommended_playbook: "hub",
      resources: ["transportation", "goods"],
    },
  }
  const store = { id: "sel_1", name: "Alpha Kitchen", handle: "alpha-kitchen" }

  let assignments: Array<{ recipe_id: string }>
  let registry: Array<{ recipe_id: string }>
  let listRequests: jest.Mock

  const container = () =>
    ({
      resolve: (key: string) => {
        if (key === REQUEST_MODULE) return { listRequests }
        if (key === Modules.AUTH) {
          return { listAuthIdentities: async () => [{ id: "authid_1", app_metadata: { seller_id: "sel_1" } }] }
        }
        if (key === PLAYBOOK_MODULE) {
          return {
            listPlaybookAssignments: async () => assignments,
            listPlaybooks: async ({ recipe_id }: { recipe_id: string }) =>
              registry.filter((row) => row.recipe_id === recipe_id),
          }
        }
        throw new Error(`unexpected resolve(${key})`)
      },
    }) as unknown as MedusaContainer

  beforeEach(() => {
    jest.clearAllMocks()
    assignments = []
    registry = [{ recipe_id: "stall" }]
    listRequests = jest.fn().mockResolvedValue([request])
    mockResolveLinkedStore.mockResolvedValue({ kind: "live", seller: store, memberId: "mem_1" })
    mockIsUnfinishedApprovalOf.mockResolvedValue(true)
    mockRun.mockResolvedValue({ result: {} })
  })

  it("reads approved seller applications only", async () => {
    await backfillApprovedSellerPlaybooks(container(), { apply: false })
    expect(listRequests).toHaveBeenCalledWith(
      { type: ["seller", "seller_creation"], status: ["accepted", "completed"] },
      { order: { created_at: "ASC" } }
    )
  })

  it("a dry run lists what it would assign and writes nothing", async () => {
    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: false })

    expect(summary.would_assign).toEqual([
      { request_id: "req_1", seller_id: "sel_1", recipe_id: "stall", roles: ["stall", "kitchen"] },
    ])
    expect(summary.assigned).toEqual([])
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("apply assigns what approval would have, and only if the seller is still unassigned", async () => {
    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: true })

    expect(summary.assigned).toHaveLength(1)
    expect(mockRun).toHaveBeenCalledWith({
      input: {
        seller_id: "sel_1",
        recipe_id: "stall",
        recommended_recipe_id: "hub",
        metadata: { roles: ["stall", "kitchen"], resources: ["transportation", "goods"] },
        only_if_unassigned: true,
      },
    })
    expect(mockIsUnfinishedApprovalOf).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "live" }),
      { requestId: "req_1", loginId: "authid_1", handle: "alpha-kitchen", applicantEmail: "alpha@example.com" }
    )
  })

  it("refuses a seller who already has an assignment, whatever it is", async () => {
    assignments = [{ recipe_id: "kitchen" }]

    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: true })

    expect(summary.already_assigned).toEqual([
      expect.objectContaining({ request_id: "req_1", seller_id: "sel_1", recipe_id: "kitchen" }),
    ])
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("counts an assignment made between its read and its write as refused, not as a failure", async () => {
    // A failed workflow run rejects with the step's error as a plain object,
    // not an Error (measured on Postgres).
    mockRun.mockRejectedValueOnce({
      name: "Error",
      message: 'assign-playbook: seller sel_1 already has a playbook assignment ("hub"); nothing was changed',
    })

    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: true })

    expect(summary.assigned).toEqual([])
    expect(summary.already_assigned).toHaveLength(1)
    expect(summary.review).toEqual([])
  })

  it("refuses a login with no live store link", async () => {
    mockResolveLinkedStore.mockResolvedValueOnce({ kind: "removed", seller: store, actor: "mem_1" })

    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: true })

    expect(summary.review).toEqual([expect.objectContaining({ reason: expect.stringContaining("link: removed") })])
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("refuses a store this application did not make (an approval before SD-139 could link another store)", async () => {
    mockIsUnfinishedApprovalOf.mockResolvedValueOnce(false)

    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: true })

    expect(summary.review).toEqual([
      expect.objectContaining({ seller_id: "sel_1", reason: expect.stringContaining("is not one this application made") }),
    ])
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("refuses while the registry has no row for the recipe", async () => {
    registry = []

    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: true })

    expect(summary.review).toEqual([
      expect.objectContaining({ recipe_id: "stall", reason: expect.stringContaining('no "stall" row') }),
    ])
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("refuses an application whose data cannot be read", async () => {
    listRequests.mockResolvedValueOnce([{ ...request, data: { member: {} } }])

    const summary = await backfillApprovedSellerPlaybooks(container(), { apply: true })

    expect(summary.review).toEqual([expect.objectContaining({ reason: expect.stringContaining("cannot be read") })])
  })
})
