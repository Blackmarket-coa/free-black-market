import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../../modules/request"
import { inspectLogin, removeSellerApplications } from "../login-shared"

type Identity = Record<string, unknown> | undefined

function makeContainer(
  identity: Identity,
  opts: { approved?: unknown[]; pending?: Array<{ id: string }>; members?: unknown[] } = {}
) {
  const listAuthIdentities = jest.fn().mockResolvedValue(identity ? [identity] : [])
  const listRequests = jest.fn().mockResolvedValue(opts.pending ?? [])
  const deleteRequests = jest.fn().mockResolvedValue(undefined)
  const graph = jest.fn().mockResolvedValue({ data: opts.members ?? [] })
  const container = {
    resolve: (key: string) => {
      if (key === Modules.AUTH) return { listAuthIdentities }
      if (key === REQUEST_MODULE) return { listRequests, deleteRequests }
      if (key === ContainerRegistrationKeys.QUERY) return { graph }
      throw new Error(`unexpected key ${key}`)
    },
  } as any
  return { container, listAuthIdentities, listRequests, deleteRequests, graph }
}

const shopperLogin = (extra: Record<string, unknown> = {}) => ({
  app_metadata: { customer_id: "cus_1", ...extra },
  provider_identities: [{ id: "pi_1", provider: "emailpass", entity_id: "buyer@fbm.test" }],
})

describe("inspectLogin", () => {
  it("lets a shopper-only login go", async () => {
    const { container } = makeContainer(shopperLogin())
    await expect(inspectLogin(container, "authid_1")).resolves.toEqual({
      keep: null,
      submitterIds: ["authid_1", "pi_1"],
    })
  })

  it.each([["seller_id"], ["user_id"], ["driver_id"], ["restaurant_id"]])(
    "keeps a login also linked as %s, without looking further",
    async (key) => {
      const { container, listRequests, graph } = makeContainer(shopperLogin({ [key]: "x_1" }))
      const use = await inspectLogin(container, "authid_1")
      expect(use.keep).toMatch(key)
      expect(listRequests).not.toHaveBeenCalled()
      expect(graph).not.toHaveBeenCalled()
    }
  )

  it("ignores links that are empty", async () => {
    const { container } = makeContainer(shopperLogin({ seller_id: null, user_id: "" }))
    await expect(inspectLogin(container, "authid_1")).resolves.toMatchObject({ keep: null })
  })

  it("does not look at vendor applications at all: anyone can file one by email, and an approved one outlives the vendor", async () => {
    const { container, listRequests } = makeContainer(shopperLogin(), {
      pending: [{ id: "req_1" }],
      approved: [{ id: "req_2" }],
    })
    await expect(inspectLogin(container, "authid_1")).resolves.toMatchObject({ keep: null })
    expect(listRequests).not.toHaveBeenCalled()
  })

  it("keeps the login of a vendor team member with the same email, matched exactly and ignoring case", async () => {
    const login = {
      app_metadata: { customer_id: "cus_1" },
      provider_identities: [{ id: "pi_1", provider: "emailpass", entity_id: "o_brien%x@fbm.test" }],
    }
    const { container, graph } = makeContainer(login, { members: [{ id: "mem_1" }] })
    const use = await inspectLogin(container, "authid_1")
    expect(use.keep).toMatch(/team member/)
    expect(graph).toHaveBeenCalledWith({
      entity: "member",
      fields: ["id"],
      filters: { $or: [{ email: { $ilike: "o\\_brien\\%x@fbm.test" } }] },
    })
  })

  it("treats a login that is already gone as nothing to keep", async () => {
    const { container, listRequests } = makeContainer(undefined)
    await expect(inspectLogin(container, "authid_gone")).resolves.toEqual({
      keep: null,
      submitterIds: ["authid_gone"],
    })
    expect(listRequests).not.toHaveBeenCalled()
  })

  it("asks for the identity with its provider identities", async () => {
    const { container, listAuthIdentities } = makeContainer(shopperLogin())
    await inspectLogin(container, "authid_9")
    expect(listAuthIdentities).toHaveBeenCalledWith(
      { id: ["authid_9"] },
      { relations: ["provider_identities"] }
    )
  })

  it("lets a check that fails throw, so the route can stop before writing anything", async () => {
    const { container, graph } = makeContainer(shopperLogin())
    graph.mockRejectedValueOnce(new Error("db down"))
    await expect(inspectLogin(container, "authid_1")).rejects.toThrow("db down")
  })
})

describe("removeSellerApplications", () => {
  it("deletes the vendor applications made with the login that never became a vendor, under both type names", async () => {
    const { container, listRequests, deleteRequests } = makeContainer(shopperLogin(), {
      pending: [{ id: "req_1" }, { id: "req_2" }],
    })
    await expect(removeSellerApplications(container, ["authid_1", "pi_1"])).resolves.toBe(2)
    expect(listRequests).toHaveBeenCalledWith({
      type: ["seller", "seller_creation"],
      submitter_id: ["authid_1", "pi_1"],
      status: ["pending", "rejected", "cancelled"],
    })
    expect(deleteRequests).toHaveBeenCalledWith(["req_1", "req_2"])
  })

  it("deletes nothing when there are none", async () => {
    const { container, deleteRequests } = makeContainer(shopperLogin())
    await expect(removeSellerApplications(container, ["authid_1"])).resolves.toBe(0)
    expect(deleteRequests).not.toHaveBeenCalled()
  })
})
