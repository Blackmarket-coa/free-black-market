"use server"
import { logger } from "@/lib/logger"

import { medusaFetch, sdk } from "../config"
import { VENDOR_PANEL_URL } from "@/const"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { redirect } from "next/navigation"
import {
  getAuthHeaders,
  getCacheOptions,
  getCacheTag,
  getCartId,
  removeAuthToken,
  removeCartId,
  setAuthToken,
} from "./cookies"

/* ---------------------------------------------
 * SAFE CUSTOMER FETCH (SERVER-COMPONENT SAFE)
 * -------------------------------------------- */
export const retrieveCustomer =
  async (): Promise<HttpTypes.StoreCustomer | null> => {
    try {
      const authHeaders = await getAuthHeaders()
      if (!authHeaders) return null

      const { customer } = await medusaFetch<{
        customer: HttpTypes.StoreCustomer
      }>(`/store/customers/me`, {
        method: "GET",
        headers: authHeaders,
        cache: "no-store", // 🔴 NEVER cache auth
      })

      return customer ?? null
    } catch {
      return null
    }
  }

export const retrieveCustomerContext = async (): Promise<{
  customer: HttpTypes.StoreCustomer | null
  isAuthenticated: boolean
}> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    return { customer: null, isAuthenticated: false }
  }

  const maxAttempts = 2

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { customer } = await medusaFetch<{
        customer: HttpTypes.StoreCustomer
      }>(`/store/customers/me`, {
        method: "GET",
        headers: authHeaders,
        cache: "no-store",
      })

      return { customer: customer ?? null, isAuthenticated: true }
    } catch (error) {
      const err = error as {
        status?: number
        statusCode?: number
        response?: { status?: number }
        cause?: { status?: number }
      }
      const status =
        err?.status ||
        err?.statusCode ||
        err?.response?.status ||
        err?.cause?.status

      if (status === 401) {
        // Try to clear invalid tokens (best effort in Server Component context)
        try {
          await removeAuthToken()
        } catch {
          // noop
        }

        return { customer: null, isAuthenticated: false }
      }

      const isLastAttempt = attempt === maxAttempts
      if (isLastAttempt) {
        // Transient failure: keep user in authenticated state to avoid flashing login.
        return { customer: null, isAuthenticated: true }
      }
    }
  }

  return { customer: null, isAuthenticated: true }
}

/* ---------------------------------------------
 * UPDATE CUSTOMER
 * -------------------------------------------- */
export const updateCustomer = async (formData: FormData) => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    return { success: false, error: "Not authenticated" }
  }

  const body: HttpTypes.StoreUpdateCustomer = {
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    phone: formData.get("phone") as string,
  }

  try {
    const customer = await sdk.store.customer
      .update(body, {}, authHeaders)
      .then(({ customer }) => customer)

    const cacheTag = await getCacheTag("customers")
    revalidateTag(cacheTag)

    return { success: true, error: null, customer }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) }
  }
}

/* ---------------------------------------------
 * ERROR NORMALIZER
 * -------------------------------------------- */
function getErrorMessage(error: unknown): string {
  const err = error as {
    message?: string
    body?: { message?: string }
    errors?: Array<{ message?: string } | string>
  }
  if (err?.message) return err.message
  if (err?.body?.message) return err.body.message
  if (Array.isArray(err?.errors)) {
    return err.errors
      .map((e) => (typeof e === "string" ? e : e.message || String(e)))
      .join(", ")
  }
  if (typeof error === "string") return error
  logger.error("Unhandled error:", error)
  return "An unexpected error occurred. Please try again."
}

/* ---------------------------------------------
 * SIGNUP
 *
 * Medusa's sign-up is two calls. Registering the email and password returns a
 * token minted before any shopper profile exists, so it carries no customer
 * id. Creating the profile with it works (that route accepts such a token),
 * but every other customer route refuses it, `/store/customers/me` and the
 * cart transfer included. So once the profile exists the token is traded for
 * a fresh one, which Medusa mints with the new customer id
 * (`POST /auth/token/refresh`).
 *
 * Until 2026-11-16 this kept the registration token as the session: the
 * account was created but the buyer was not signed in, the form showed
 * nothing (or "Unauthorized" when a cart had to be moved onto the account),
 * and pressing it again answered "Identity with email already exists".
 * -------------------------------------------- */
const IDENTITY_EXISTS = "Identity with email already exists"

const EXISTING_ACCOUNT_MESSAGE =
  'An account with this email already exists. Sign in with your password, or use "Forgot password?" to set a new one.'

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

/** `sdk.auth.*` answers a token string; some versions answer `{ token }`. */
const tokenFrom = (response: unknown): string | null => {
  if (typeof response === "string") return response || null
  const token = (response as { token?: unknown } | null)?.token
  return typeof token === "string" && token ? token : null
}

const isIdentityExists = (error: unknown) =>
  (error as { message?: string } | null)?.message === IDENTITY_EXISTS

const VENDOR_LOGIN_MESSAGE =
  "This email is registered as a vendor account. Vendor accounts sign in at the Vendor Portal; to shop, sign up with a different email."
const STAFF_LOGIN_MESSAGE =
  "This email belongs to a staff or partner login, which can't also hold a shopper account here. Sign up with a different email to shop."
const CLOSED_PROFILE_MESSAGE =
  "The shopper account for this email was closed. Contact support to reopen it, or sign up with a different email."
const TAKEN_EMAIL_MESSAGE =
  "This email already belongs to another shopper account. Sign in with that account, or contact support."
const SETUP_FAILED_MESSAGE =
  "We couldn't finish setting up your account. Please try again in a moment."

/** A link to an actor other than a customer (seller, user, driver, ...). */
const otherActorLink = (appMetadata: Record<string, unknown>) =>
  Object.entries(appMetadata).some(
    ([key, value]) => key !== "customer_id" && key.endsWith("_id") && Boolean(value)
  )

/**
 * Why a login with no shopper profile must not be given one here, or null.
 * A vendor or staff login keeps its roles apart from shopping; a profile that
 * was closed leaves `customer_id` behind (Medusa unlinks with null), and
 * Medusa refuses a second profile for that login.
 */
const profileRefusal = (
  appMetadata: Record<string, unknown>
): { message: string; vendor?: true } | null => {
  if (appMetadata.seller_id) return { message: VENDOR_LOGIN_MESSAGE, vendor: true }
  if (otherActorLink(appMetadata)) return { message: STAFF_LOGIN_MESSAGE }
  if ("customer_id" in appMetadata) return { message: CLOSED_PROFILE_MESSAGE }
  return null
}

/** What to tell the buyer when the profile could not be created. */
const profileCreateFailure = (error: unknown) =>
  /already has an account/i.test(String((error as { message?: string } | null)?.message ?? ""))
    ? TAKEN_EMAIL_MESSAGE
    : SETUP_FAILED_MESSAGE

/**
 * Create the shopper profile for a login that has none, and return a token
 * that carries the new customer id.
 */
async function createProfileAndRefresh(
  token: string,
  profile: HttpTypes.StoreCreateCustomer
): Promise<{ customer: HttpTypes.StoreCustomer; token: string }> {
  const { customer } = await sdk.store.customer.create(profile, {}, bearer(token))
  const refreshed = tokenFrom(await sdk.auth.refresh(bearer(token)))
  if (!refreshed || !decodeTokenPayload(refreshed)?.actor_id) {
    throw new Error("Sign-up failed: invalid authentication response")
  }
  return { customer, token: refreshed }
}

/**
 * Returns the new customer, `null` when the email already had a shopper
 * profile and the password signed the buyer into it, or an error message.
 */
export async function signup(
  formData: FormData
): Promise<HttpTypes.StoreCustomer | null | string> {
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim()
  const password = String(formData.get("password") || "")

  const customerForm = {
    email,
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    phone: formData.get("phone") as string,
  }

  try {
    let token: string | null
    try {
      token = tokenFrom(
        await sdk.auth.register("customer", "emailpass", { email, password })
      )
    } catch (error) {
      if (!isIdentityExists(error)) throw error
      // The email already has a login: an earlier sign-up made it (the old
      // flow never signed the buyer in, so they could not tell it had worked)
      // or one stopped after making it. Only the right password goes further.
      try {
        token = tokenFrom(
          await sdk.auth.login("customer", "emailpass", { email, password })
        )
      } catch {
        return EXISTING_ACCOUNT_MESSAGE
      }
    }
    if (!token) {
      throw new Error("Sign-up failed: invalid authentication response")
    }

    let customer: HttpTypes.StoreCustomer | null = null
    const payload = decodeTokenPayload(token)
    if (!payload?.actor_id) {
      const refusal = profileRefusal(
        (payload?.app_metadata ?? {}) as Record<string, unknown>
      )
      if (refusal) return refusal.message
      try {
        ;({ customer, token } = await createProfileAndRefresh(token, customerForm))
      } catch (error) {
        logger.error("Signup: creating the shopper profile failed:", error)
        return profileCreateFailure(error)
      }
    }

    await setAuthToken(token)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    // The buyer is signed in from here on; a cart that cannot be moved onto
    // the account is not a failed sign-up.
    try {
      await transferCart()
    } catch (error) {
      logger.warn("Cart transfer failed after signup — continuing", error)
    }

    return customer
  } catch (error) {
    logger.error("Signup error:", error)
    return getErrorMessage(error)
  }
}

/* ---------------------------------------------
 * LOGIN
 * -------------------------------------------- */
export type LoginResult =
  | {
      error: string
      code?: "vendor_account"
      vendorUrl?: string
    }
  | undefined

/**
 * Best-effort decode of a Medusa JWT payload (no signature verification —
 * we only use it to explain a failed login, never to grant access).
 */
const decodeTokenPayload = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split(".")[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded =
      normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
  } catch {
    return null
  }
}

const getErrorStatus = (error: unknown): number | undefined => {
  const err = error as {
    status?: number
    statusCode?: number
    response?: { status?: number }
    cause?: { status?: number }
  }
  return (
    err?.status || err?.statusCode || err?.response?.status || err?.cause?.status
  )
}

export async function login(formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") || "")
    .toLowerCase()
    .trim()
  const password = String(formData.get("password") || "")

  try {
    const tokenResponse = await sdk.auth.login("customer", "emailpass", {
      email,
      password,
    })

    // Handle both string token and object response { token: string }
    const token = typeof tokenResponse === "string"
      ? tokenResponse
      : (tokenResponse as any)?.token

    if (!token || typeof token !== "string") {
      logger.error("[login] Invalid token response:", tokenResponse)
      return { error: "Login failed: Invalid authentication response" }
    }

    logger.info("[login] Token received, length:", token.length)

    // The password is right. A token that names no customer belongs to a login
    // with no shopper profile: decide here, before any session is stored.
    const payload = decodeTokenPayload(token)
    if (payload && !payload.actor_id) {
      await removeAuthToken()
      const refusal = profileRefusal(
        (payload.app_metadata ?? {}) as Record<string, unknown>
      )
      if (refusal?.vendor) {
        return { error: refusal.message, code: "vendor_account", vendorUrl: VENDOR_PANEL_URL }
      }
      if (refusal) return { error: refusal.message }

      // A login with no role at all is a storefront sign-up that stopped after
      // registering the email (or a vendor application not yet approved; the
      // backend's account deletion keeps such a login, lib/login-shared.ts).
      // Finish it rather than send the buyer to a sign-up form that answers
      // "already exists".
      let refreshed: string
      try {
        ;({ token: refreshed } = await createProfileAndRefresh(token, { email }))
      } catch (createError) {
        logger.error("[login] Could not finish an unfinished sign-up:", createError)
        return { error: profileCreateFailure(createError) }
      }
      await setAuthToken(refreshed)
      const customerCacheTag = await getCacheTag("customers")
      revalidateTag(customerCacheTag)
      try {
        await transferCart()
      } catch {
        logger.warn("Cart transfer failed — continuing login")
      }
      return
    }

    await setAuthToken(token)

    // The emailpass identity is shared across actor types, so a vendor-only
    // account "logs in" here successfully without having a customer record.
    // Verify the token maps to a real customer now — otherwise the account
    // page 401s and silently bounces the user back to this login form.
    try {
      const authHeaders = await getAuthHeaders()
      const { customer } = await medusaFetch<{
        customer: HttpTypes.StoreCustomer
      }>(`/store/customers/me`, {
        method: "GET",
        headers: authHeaders || {},
        cache: "no-store",
      })

      if (!customer) {
        await removeAuthToken()
        return {
          error:
            "We couldn't find a shopper profile for this login. Please register a shopper account to start buying.",
        }
      }
    } catch (probeError) {
      if (getErrorStatus(probeError) === 401) {
        // The token names a customer the backend no longer serves.
        await removeAuthToken()

        const appMetadata = (decodeTokenPayload(token)?.app_metadata ?? {}) as Record<
          string,
          unknown
        >
        if (appMetadata.seller_id) {
          return {
            error: VENDOR_LOGIN_MESSAGE,
            code: "vendor_account",
            vendorUrl: VENDOR_PANEL_URL,
          }
        }

        return {
          error: "We couldn't find a shopper profile for this login.",
        }
      }
      // Transient failure: keep the session — the account page degrades
      // gracefully and retries on its own.
    }

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)
  } catch (error) {
    logger.error("Login error:", error)
    return { error: getErrorMessage(error) }
  }

  try {
    await transferCart()
  } catch {
    logger.warn("Cart transfer failed — continuing login")
  }
}

/* ---------------------------------------------
 * SIGNOUT
 * -------------------------------------------- */
export async function signout() {
  try {
    await sdk.auth.logout()
  } catch {}

  await removeAuthToken()
  await removeCartId()

  revalidateTag(await getCacheTag("customers"))
  revalidateTag(await getCacheTag("carts"))

  redirect("/")
}

/* ---------------------------------------------
 * DATA RIGHTS (CCPA/CPRA)
 * -------------------------------------------- */

/**
 * Right to know / portability: returns the authenticated customer's full data
 * export (profile, addresses, orders) as a plain object the client can download.
 */
export async function exportCustomerData(): Promise<
  { success: true; data: unknown } | { success: false; error: string }
> {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return { success: false, error: "Not authenticated" }

  try {
    const data = await medusaFetch<unknown>(`/store/customers/me/data-export`, {
      method: "GET",
      headers: authHeaders,
      cache: "no-store",
    })
    return { success: true, data }
  } catch (error) {
    logger.error("exportCustomerData failed:", error)
    return {
      success: false,
      error: "Could not generate your data export. Please try again.",
    }
  }
}

/**
 * Right to delete: erases the authenticated customer's personal data on the
 * backend, then clears the local session so the account is fully signed out.
 * The caller redirects home on success.
 */
export async function deleteCustomerAccount(): Promise<
  { success: true } | { success: false; error: string }
> {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return { success: false, error: "Not authenticated" }

  try {
    await medusaFetch<{ deleted: boolean }>(`/store/customers/me/deletion`, {
      method: "POST",
      headers: authHeaders,
      cache: "no-store",
    })
  } catch (error) {
    logger.error("deleteCustomerAccount failed:", error)
    return {
      success: false,
      error: "Could not delete your account. Please contact support.",
    }
  }

  // Clear the local session (mirrors signout()).
  try {
    await sdk.auth.logout()
  } catch {}
  await removeAuthToken()
  await removeCartId()
  revalidateTag(await getCacheTag("customers"))
  revalidateTag(await getCacheTag("carts"))

  return { success: true }
}

/* ---------------------------------------------
 * CART TRANSFER
 * -------------------------------------------- */
export async function transferCart() {
  const cartId = await getCartId()
  if (!cartId) return

  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return

  await sdk.store.cart.transferCart(cartId, {}, authHeaders)

  const cartCacheTag = await getCacheTag("carts")
  revalidateTag(cartCacheTag)
}

/* ---------------------------------------------
 * ADDRESS HELPERS
 * -------------------------------------------- */
export const addCustomerAddress = async (formData: FormData) => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return { success: false, error: "Not authenticated" }

  const address = {
    address_name: formData.get("address_name") as string,
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    company: formData.get("company") as string,
    address_1: formData.get("address_1") as string,
    city: formData.get("city") as string,
    postal_code: formData.get("postal_code") as string,
    country_code: formData.get("country_code") as string,
    phone: formData.get("phone") as string,
    province: formData.get("province") as string,
    is_default_billing: Boolean(formData.get("isDefaultBilling")),
    is_default_shipping: Boolean(formData.get("isDefaultShipping")),
  }

  try {
    await sdk.store.customer.createAddress(address, {}, authHeaders)
    revalidateTag(await getCacheTag("customers"))
    return { success: true, error: null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const deleteCustomerAddress = async (addressId: string) => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) return

  await sdk.store.customer.deleteAddress(addressId, authHeaders)
  revalidateTag(await getCacheTag("customers"))
}

export const updateCustomerAddress = async (formData: FormData) => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders) {
    return { success: false, error: "Not authenticated" }
  }

  const addressId = formData.get("addressId") as string
  if (!addressId) {
    return { success: false, error: "Address ID is required" }
  }

  const address: HttpTypes.StoreUpdateCustomerAddress = {
    address_name: formData.get("address_name") as string,
    first_name: formData.get("first_name") as string,
    last_name: formData.get("last_name") as string,
    company: formData.get("company") as string,
    address_1: formData.get("address_1") as string,
    address_2: formData.get("address_2") as string,
    city: formData.get("city") as string,
    postal_code: formData.get("postal_code") as string,
    province: formData.get("province") as string,
    country_code: formData.get("country_code") as string,
    phone: formData.get("phone") as string,
  }

  try {
    await sdk.store.customer.updateAddress(addressId, address, {}, authHeaders)
    revalidateTag(await getCacheTag("customers"))
    return { success: true, error: null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/* ---------------------------------------------
 * PASSWORD RESET
 * -------------------------------------------- */
export const sendResetPasswordEmail = async (email: string) => {
  try {
    await sdk.auth.resetPassword("customer", "emailpass", {
      identifier: email,
    })
    return { success: true, error: null }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export const updateCustomerPassword = async (
  newPassword: string,
  token: string
) => {
  try {
    await sdk.auth.updateProvider("customer", "emailpass", {
      password: newPassword,
    }, token)
    return { success: true, error: null }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) }
  }
}
