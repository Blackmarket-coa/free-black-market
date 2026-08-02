import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  authLogin: vi.fn(),
  authRegister: vi.fn(),
  authLogout: vi.fn(),
  authReset: vi.fn(),
  authUpdateProvider: vi.fn(),
  custUpdate: vi.fn(),
  custCreate: vi.fn(),
  custCreateAddr: vi.fn(),
  custDeleteAddr: vi.fn(),
  custUpdateAddr: vi.fn(),
  cartTransfer: vi.fn(),
  getAuthHeaders: vi.fn(),
  getCacheTag: vi.fn(),
  getCacheOptions: vi.fn(),
  getCartId: vi.fn(),
  setAuthToken: vi.fn(),
  removeAuthToken: vi.fn(),
  removeCartId: vi.fn(),
  revalidateTag: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/lib/config", () => ({
  medusaFetch: h.medusaFetch,
  sdk: {
    auth: {
      login: h.authLogin,
      register: h.authRegister,
      logout: h.authLogout,
      resetPassword: h.authReset,
      updateProvider: h.authUpdateProvider,
    },
    store: {
      customer: {
        update: h.custUpdate,
        create: h.custCreate,
        createAddress: h.custCreateAddr,
        deleteAddress: h.custDeleteAddr,
        updateAddress: h.custUpdateAddr,
      },
      cart: { transferCart: h.cartTransfer },
    },
  },
}))

vi.mock("@/lib/data/cookies", () => ({
  getAuthHeaders: h.getAuthHeaders,
  getCacheTag: h.getCacheTag,
  getCacheOptions: h.getCacheOptions,
  getCartId: h.getCartId,
  setAuthToken: h.setAuthToken,
  removeAuthToken: h.removeAuthToken,
  removeCartId: h.removeCartId,
}))

vi.mock("next/cache", () => ({ revalidateTag: h.revalidateTag }))
vi.mock("next/navigation", () => ({ redirect: h.redirect }))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  addCustomerAddress,
  deleteCustomerAddress,
  login,
  retrieveCustomer,
  retrieveCustomerContext,
  sendResetPasswordEmail,
  signout,
  signup,
  transferCart,
  updateCustomer,
  updateCustomerAddress,
  updateCustomerPassword,
} from "@/lib/data/customer"

const authed = { Authorization: "Bearer t" }

const fd = (entries: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getAuthHeaders.mockResolvedValue(authed)
  h.getCacheTag.mockResolvedValue("tag")
  h.getCacheOptions.mockResolvedValue({})
  h.getCartId.mockResolvedValue("cart_1")
})

describe("retrieveCustomer", () => {
  it("returns null without auth headers", async () => {
    h.getAuthHeaders.mockResolvedValue(null)
    await expect(retrieveCustomer()).resolves.toBeNull()
    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("returns the customer on success", async () => {
    h.medusaFetch.mockResolvedValue({ customer: { id: "cus_1" } })
    await expect(retrieveCustomer()).resolves.toEqual({ id: "cus_1" })
  })

  it("returns null when the fetch throws", async () => {
    h.medusaFetch.mockRejectedValue(new Error("401"))
    await expect(retrieveCustomer()).resolves.toBeNull()
  })
})

describe("retrieveCustomerContext", () => {
  it("is unauthenticated without auth headers", async () => {
    h.getAuthHeaders.mockResolvedValue(null)
    await expect(retrieveCustomerContext()).resolves.toEqual({
      customer: null,
      isAuthenticated: false,
    })
  })

  it("returns the customer when authenticated", async () => {
    h.medusaFetch.mockResolvedValue({ customer: { id: "cus_1" } })
    await expect(retrieveCustomerContext()).resolves.toEqual({
      customer: { id: "cus_1" },
      isAuthenticated: true,
    })
  })

  it("clears the token and de-authenticates on 401", async () => {
    h.medusaFetch.mockRejectedValue({ status: 401 })
    await expect(retrieveCustomerContext()).resolves.toEqual({
      customer: null,
      isAuthenticated: false,
    })
    expect(h.removeAuthToken).toHaveBeenCalled()
  })

  it("keeps the user authenticated on a transient (non-401) failure", async () => {
    h.medusaFetch.mockRejectedValue({ status: 500 })
    await expect(retrieveCustomerContext()).resolves.toEqual({
      customer: null,
      isAuthenticated: true,
    })
    // retried up to maxAttempts (2)
    expect(h.medusaFetch).toHaveBeenCalledTimes(2)
  })
})

describe("updateCustomer", () => {
  it("errors when not authenticated", async () => {
    h.getAuthHeaders.mockResolvedValue(null)
    await expect(updateCustomer(fd({ first_name: "A" }))).resolves.toEqual({
      success: false,
      error: "Not authenticated",
    })
  })

  it("updates and revalidates on success", async () => {
    h.custUpdate.mockResolvedValue({ customer: { id: "cus_1" } })
    const res = await updateCustomer(fd({ first_name: "A", last_name: "B" }))
    expect(res).toEqual({ success: true, error: null, customer: { id: "cus_1" } })
    expect(h.revalidateTag).toHaveBeenCalledWith("tag")
  })

  it("returns an error message on failure", async () => {
    h.custUpdate.mockRejectedValue(new Error("nope"))
    await expect(updateCustomer(fd({}))).resolves.toEqual({
      success: false,
      error: "nope",
    })
  })
})

describe("signup", () => {
  it("registers, creates the customer, and returns it", async () => {
    h.authRegister.mockResolvedValue("token123")
    h.custCreate.mockResolvedValue({ customer: { id: "cus_new" } })
    h.cartTransfer.mockResolvedValue(undefined)

    const res = await signup(
      fd({ email: "A@X.com", password: "pw", first_name: "A", last_name: "B" })
    )
    expect(res).toEqual({ id: "cus_new" })
    expect(h.setAuthToken).toHaveBeenCalledWith("token123")
    // email is normalized to lowercase
    expect(h.authRegister).toHaveBeenCalledWith("customer", "emailpass", {
      email: "a@x.com",
      password: "pw",
    })
  })

  it("returns an error message when registration fails", async () => {
    h.authRegister.mockRejectedValue(new Error("dupe"))
    await expect(signup(fd({ email: "a@x.com", password: "pw" }))).resolves.toBe(
      "dupe"
    )
  })
})

describe("login", () => {
  const makeToken = (payload: Record<string, unknown>) =>
    `hdr.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`

  it("stores a string token", async () => {
    h.authLogin.mockResolvedValue("tok_str")
    h.medusaFetch.mockResolvedValue({ customer: { id: "cus_1" } })
    await expect(login(fd({ email: "a@x.com", password: "pw" }))).resolves.toBeUndefined()
    expect(h.setAuthToken).toHaveBeenCalledWith("tok_str")
  })

  it("stores a token from an object response", async () => {
    h.authLogin.mockResolvedValue({ token: "tok_obj" })
    h.medusaFetch.mockResolvedValue({ customer: { id: "cus_1" } })
    await login(fd({ email: "a@x.com", password: "pw" }))
    expect(h.setAuthToken).toHaveBeenCalledWith("tok_obj")
  })

  it("returns an error when the token is missing", async () => {
    h.authLogin.mockResolvedValue({ nope: true })
    await expect(login(fd({ email: "a@x.com", password: "pw" }))).resolves.toEqual({
      error: "Login failed: Invalid authentication response",
    })
    expect(h.setAuthToken).not.toHaveBeenCalled()
  })

  it("returns the error message when auth fails", async () => {
    h.authLogin.mockRejectedValue(new Error("bad creds"))
    await expect(login(fd({ email: "a@x.com", password: "pw" }))).resolves.toEqual({
      error: "bad creds",
    })
  })

  it("points vendor-only identities at the vendor portal instead of looping", async () => {
    // Shared emailpass identity: the password verifies, but the token has no
    // customer actor — only a seller link in app_metadata.
    h.authLogin.mockResolvedValue(
      makeToken({ actor_id: "", app_metadata: { seller_id: "sel_1" } })
    )
    h.medusaFetch.mockRejectedValue({ status: 401 })

    const res = await login(fd({ email: "vendor@x.com", password: "pw" }))

    expect(res).toMatchObject({ code: "vendor_account" })
    expect(res?.vendorUrl).toBeTruthy()
    expect(res?.error).toMatch(/vendor/i)
    expect(h.removeAuthToken).toHaveBeenCalled()
  })

  it("returns a registration hint for identities with no customer or seller", async () => {
    h.authLogin.mockResolvedValue(makeToken({ actor_id: "", app_metadata: {} }))
    h.medusaFetch.mockRejectedValue({ status: 401 })

    const res = await login(fd({ email: "ghost@x.com", password: "pw" }))

    expect(res?.error).toMatch(/shopper/i)
    expect(res?.code).toBeUndefined()
    expect(h.removeAuthToken).toHaveBeenCalled()
  })

  it("keeps the session on a transient customers/me failure", async () => {
    h.authLogin.mockResolvedValue("tok_str")
    h.medusaFetch.mockRejectedValue({ status: 500 })

    await expect(
      login(fd({ email: "a@x.com", password: "pw" }))
    ).resolves.toBeUndefined()
    expect(h.removeAuthToken).not.toHaveBeenCalled()
  })
})

describe("signout", () => {
  it("clears tokens and redirects home", async () => {
    h.authLogout.mockResolvedValue(undefined)
    await signout()
    expect(h.removeAuthToken).toHaveBeenCalled()
    expect(h.removeCartId).toHaveBeenCalled()
    expect(h.redirect).toHaveBeenCalledWith("/")
  })
})

describe("transferCart", () => {
  it("no-ops without a cart id", async () => {
    h.getCartId.mockResolvedValue(undefined)
    await transferCart()
    expect(h.cartTransfer).not.toHaveBeenCalled()
  })

  it("no-ops without auth headers", async () => {
    h.getAuthHeaders.mockResolvedValue(null)
    await transferCart()
    expect(h.cartTransfer).not.toHaveBeenCalled()
  })

  it("transfers the cart when authenticated", async () => {
    h.cartTransfer.mockResolvedValue(undefined)
    await transferCart()
    expect(h.cartTransfer).toHaveBeenCalledWith("cart_1", {}, authed)
  })
})

describe("address helpers", () => {
  it("addCustomerAddress errors when not authenticated", async () => {
    h.getAuthHeaders.mockResolvedValue(null)
    await expect(addCustomerAddress(fd({}))).resolves.toEqual({
      success: false,
      error: "Not authenticated",
    })
  })

  it("addCustomerAddress succeeds", async () => {
    h.custCreateAddr.mockResolvedValue({})
    await expect(
      addCustomerAddress(fd({ first_name: "A", city: "NYC" }))
    ).resolves.toEqual({ success: true, error: null })
    expect(h.revalidateTag).toHaveBeenCalled()
  })

  it("addCustomerAddress returns an error string on failure", async () => {
    h.custCreateAddr.mockRejectedValue(new Error("addr fail"))
    await expect(addCustomerAddress(fd({}))).resolves.toEqual({
      success: false,
      error: "addr fail",
    })
  })

  it("deleteCustomerAddress no-ops without auth", async () => {
    h.getAuthHeaders.mockResolvedValue(null)
    await deleteCustomerAddress("addr_1")
    expect(h.custDeleteAddr).not.toHaveBeenCalled()
  })

  it("deleteCustomerAddress deletes when authenticated", async () => {
    h.custDeleteAddr.mockResolvedValue({})
    await deleteCustomerAddress("addr_1")
    expect(h.custDeleteAddr).toHaveBeenCalledWith("addr_1", authed)
  })

  it("updateCustomerAddress requires an addressId", async () => {
    await expect(updateCustomerAddress(fd({}))).resolves.toEqual({
      success: false,
      error: "Address ID is required",
    })
  })

  it("updateCustomerAddress succeeds", async () => {
    h.custUpdateAddr.mockResolvedValue({})
    await expect(
      updateCustomerAddress(fd({ addressId: "addr_1", city: "LA" }))
    ).resolves.toEqual({ success: true, error: null })
  })
})

describe("password reset", () => {
  it("sendResetPasswordEmail success / failure", async () => {
    h.authReset.mockResolvedValueOnce({})
    await expect(sendResetPasswordEmail("a@x.com")).resolves.toEqual({
      success: true,
      error: null,
    })

    h.authReset.mockRejectedValueOnce(new Error("reset fail"))
    await expect(sendResetPasswordEmail("a@x.com")).resolves.toEqual({
      success: false,
      error: "reset fail",
    })
  })

  it("updateCustomerPassword success / failure", async () => {
    h.authUpdateProvider.mockResolvedValueOnce({})
    await expect(updateCustomerPassword("newpw", "tok")).resolves.toEqual({
      success: true,
      error: null,
    })

    h.authUpdateProvider.mockRejectedValueOnce(new Error("pw fail"))
    await expect(updateCustomerPassword("newpw", "tok")).resolves.toEqual({
      success: false,
      error: "pw fail",
    })
  })
})
