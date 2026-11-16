import { Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../../modules/request"
import { loginKeptBecause } from "../login-shared"

function makeContainer(identity: Record<string, unknown>, pendingRequests: unknown[] = []) {
  const listRequests = jest.fn().mockResolvedValue(pendingRequests)
  const retrieveAuthIdentity = jest.fn().mockResolvedValue(identity)
  const container = {
    resolve: (key: string) => {
      if (key === Modules.AUTH) return { retrieveAuthIdentity }
      if (key === REQUEST_MODULE) return { listRequests }
      throw new Error(`unexpected key ${key}`)
    },
  } as any
  return { container, listRequests, retrieveAuthIdentity }
}

describe("loginKeptBecause", () => {
  it("lets a shopper-only login go", async () => {
    const { container } = makeContainer({ app_metadata: { customer_id: "cus_1" }, provider_identities: [{ id: "pi_1" }] })
    await expect(loginKeptBecause(container, "authid_1")).resolves.toBeNull()
  })

  it.each([["seller_id"], ["user_id"], ["driver_id"], ["restaurant_id"]])(
    "keeps a login also linked as %s",
    async (key) => {
      const { container, listRequests } = makeContainer({
        app_metadata: { customer_id: "cus_1", [key]: "x_1" },
        provider_identities: [],
      })
      await expect(loginKeptBecause(container, "authid_1")).resolves.toMatch(key)
      expect(listRequests).not.toHaveBeenCalled()
    }
  )

  it("ignores links that are empty", async () => {
    const { container } = makeContainer({
      app_metadata: { customer_id: "cus_1", seller_id: null, user_id: "" },
      provider_identities: [],
    })
    await expect(loginKeptBecause(container, "authid_1")).resolves.toBeNull()
  })

  it("keeps the login of a pending vendor application, asked by auth and by provider identity", async () => {
    const { container, listRequests } = makeContainer(
      { app_metadata: { customer_id: "cus_1" }, provider_identities: [{ id: "pi_1" }, { id: "pi_2" }] },
      [{ id: "req_1" }]
    )
    await expect(loginKeptBecause(container, "authid_1")).resolves.toMatch(/vendor application/)
    expect(listRequests).toHaveBeenCalledWith(
      { type: "seller", submitter_id: ["authid_1", "pi_1", "pi_2"], status: "pending" },
      { take: 1 }
    )
  })

  it("asks for the identity with its provider identities", async () => {
    const { container, retrieveAuthIdentity } = makeContainer({ app_metadata: {}, provider_identities: [] })
    await loginKeptBecause(container, "authid_9")
    expect(retrieveAuthIdentity).toHaveBeenCalledWith("authid_9", { relations: ["provider_identities"] })
  })
})
