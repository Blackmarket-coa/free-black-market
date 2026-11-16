import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  medusaFetch: vi.fn(),
  authLogin: vi.fn(),
  authRegister: vi.fn(),
  authRefresh: vi.fn(),
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
      refresh: h.authRefresh,
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

// A JWT-shaped string whose payload decodeTokenPayload can read (no signature).
const makeToken = (payload: Record<string, unknown>) =>
  `hdr.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`

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
  const regToken = makeToken({ actor_id: "", app_metadata: {} })
  const customerToken = makeToken({ actor_id: "cus_new", app_metadata: { customer_id: "cus_new" } })
  const form = () =>
    fd({ email: "A@X.com", password: "pw", first_name: "A", last_name: "B", phone: "5551234" })

  it("creates the profile with the registration token, then signs in with a refreshed token", async () => {
    h.authRegister.mockResolvedValue(regToken)
    h.custCreate.mockResolvedValue({ customer: { id: "cus_new" } })
    h.authRefresh.mockResolvedValue(customerToken)
    h.cartTransfer.mockResolvedValue(undefined)

    const res = await signup(form())

    expect(res).toEqual({ id: "cus_new" })
    // email is normalized to lowercase
    expect(h.authRegister).toHaveBeenCalledWith("customer", "emailpass", {
      email: "a@x.com",
      password: "pw",
    })
    expect(h.custCreate).toHaveBeenCalledWith(
      { email: "a@x.com", first_name: "A", last_name: "B", phone: "5551234" },
      {},
      { Authorization: `Bearer ${regToken}` }
    )
    expect(h.authRefresh).toHaveBeenCalledWith({ Authorization: `Bearer ${regToken}` })
    // The session is the refreshed token (it names the customer), never the
    // registration token, which every customer route refuses.
    expect(h.setAuthToken).toHaveBeenCalledTimes(1)
    expect(h.setAuthToken).toHaveBeenCalledWith(customerToken)
    expect(h.cartTransfer).toHaveBeenCalled()
  })

  it("still signs the buyer in when the cart cannot be moved onto the account", async () => {
    h.authRegister.mockResolvedValue(regToken)
    h.custCreate.mockResolvedValue({ customer: { id: "cus_new" } })
    h.authRefresh.mockResolvedValue(customerToken)
    h.cartTransfer.mockRejectedValue(new Error("Unauthorized"))

    await expect(signup(form())).resolves.toEqual({ id: "cus_new" })
    expect(h.setAuthToken).toHaveBeenCalledWith(customerToken)
  })

  it("signs an existing shopper in when the email is taken and the password is theirs", async () => {
    h.authRegister.mockRejectedValue(new Error("Identity with email already exists"))
    h.authLogin.mockResolvedValue(customerToken)
    h.cartTransfer.mockResolvedValue(undefined)

    await expect(signup(form())).resolves.toBeNull()
    expect(h.authLogin).toHaveBeenCalledWith("customer", "emailpass", {
      email: "a@x.com",
      password: "pw",
    })
    expect(h.custCreate).not.toHaveBeenCalled()
    expect(h.authRefresh).not.toHaveBeenCalled()
    expect(h.setAuthToken).toHaveBeenCalledWith(customerToken)
  })

  it("finishes a sign-up that stopped after the login was made", async () => {
    const loginToken = makeToken({ actor_id: "", app_metadata: {} })
    h.authRegister.mockRejectedValue(new Error("Identity with email already exists"))
    h.authLogin.mockResolvedValue(loginToken)
    h.custCreate.mockResolvedValue({ customer: { id: "cus_new" } })
    h.authRefresh.mockResolvedValue(customerToken)

    await expect(signup(form())).resolves.toEqual({ id: "cus_new" })
    expect(h.custCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@x.com" }),
      {},
      { Authorization: `Bearer ${loginToken}` }
    )
    expect(h.setAuthToken).toHaveBeenCalledWith(customerToken)
  })

  it("says the account exists when the email is taken and the password is wrong", async () => {
    h.authRegister.mockRejectedValue(new Error("Identity with email already exists"))
    h.authLogin.mockRejectedValue(new Error("Invalid email or password"))

    const res = await signup(form())

    expect(res).toMatch(/already exists/)
    expect(res).toMatch(/Forgot password/)
    expect(h.custCreate).not.toHaveBeenCalled()
    expect(h.setAuthToken).not.toHaveBeenCalled()
  })

  it("returns an error message when registration fails for another reason", async () => {
    h.authRegister.mockRejectedValue(new Error("dupe"))
    await expect(signup(fd({ email: "a@x.com", password: "pw" }))).resolves.toBe(
      "dupe"
    )
    expect(h.authLogin).not.toHaveBeenCalled()
    expect(h.setAuthToken).not.toHaveBeenCalled()
  })

  it("does not keep a session when the refreshed token is missing", async () => {
    h.authRegister.mockResolvedValue(regToken)
    h.custCreate.mockResolvedValue({ customer: { id: "cus_new" } })
    h.authRefresh.mockResolvedValue({ nope: true })

    const res = await signup(form())

    expect(typeof res).toBe("string")
    expect(h.setAuthToken).not.toHaveBeenCalled()
  })
})

describe("login", () => {
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

  it("finishes an unfinished sign-up: a login with no profile of any kind", async () => {
    const loginToken = makeToken({ actor_id: "", app_metadata: {} })
    const customerToken = makeToken({ actor_id: "cus_9", app_metadata: { customer_id: "cus_9" } })
    h.authLogin.mockResolvedValue(loginToken)
    h.medusaFetch.mockRejectedValue({ status: 401 })
    h.custCreate.mockResolvedValue({ customer: { id: "cus_9" } })
    h.authRefresh.mockResolvedValue(customerToken)

    await expect(login(fd({ email: "Ghost@x.com", password: "pw" }))).resolves.toBeUndefined()

    expect(h.custCreate).toHaveBeenCalledWith(
      { email: "ghost@x.com" },
      {},
      { Authorization: `Bearer ${loginToken}` }
    )
    expect(h.authRefresh).toHaveBeenCalledWith({ Authorization: `Bearer ${loginToken}` })
    expect(h.setAuthToken).toHaveBeenLastCalledWith(customerToken)
    expect(h.removeAuthToken).not.toHaveBeenCalled()
  })

  it("does not keep a session when the unfinished sign-up cannot be finished", async () => {
    h.authLogin.mockResolvedValue(makeToken({ actor_id: "", app_metadata: {} }))
    h.medusaFetch.mockRejectedValue({ status: 401 })
    h.custCreate.mockRejectedValue(new Error("boom"))

    const res = await login(fd({ email: "ghost@x.com", password: "pw" }))

    expect(res?.error).toMatch(/couldn't finish/i)
    expect(h.removeAuthToken).toHaveBeenCalled()
  })

  it("leaves a login linked to another actor alone and points at sign-up", async () => {
    h.authLogin.mockResolvedValue(makeToken({ actor_id: "", app_metadata: { user_id: "user_1" } }))
    h.medusaFetch.mockRejectedValue({ status: 401 })

    const res = await login(fd({ email: "staff@x.com", password: "pw" }))

    expect(res?.error).toMatch(/shopper profile/i)
    expect(res?.code).toBeUndefined()
    expect(h.custCreate).not.toHaveBeenCalled()
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
