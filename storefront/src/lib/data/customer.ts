"use server"
import { logger } from "@/lib/logger"

import { medusaFetch, sdk } from "../config"
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
    } catch (error: any) {
      const status =
        error?.status ||
        error?.statusCode ||
        error?.response?.status ||
        error?.cause?.status

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
function getErrorMessage(error: any): string {
  if (error?.message) return error.message
  if (error?.body?.message) return error.body.message
  if (Array.isArray(error?.errors)) {
    return error.errors.map((e: any) => e.message || e).join(", ")
  }
  if (typeof error === "string") return error
  logger.error("Unhandled error:", error)
  return "An unexpected error occurred. Please try again."
}

/* ---------------------------------------------
 * SIGNUP (FIXED — NO TOKEN CHURN)
 * -------------------------------------------- */
export async function signup(formData: FormData) {
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
    // 1️⃣ Register (this already authenticates)
    const token = await sdk.auth.register("customer", "emailpass", {
      email,
      password,
    })

    await setAuthToken(token as string)

    // 2️⃣ Create customer using SAME token
    const authHeaders = await getAuthHeaders()
    if (!authHeaders) {
      throw new Error("Authentication failed after signup")
    }

    const { customer } = await sdk.store.customer.create(
      customerForm,
      {},
      authHeaders
    )

    // 3️⃣ Cache + cart
    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)

    await transferCart()

    return customer
  } catch (error) {
    logger.error("Signup error:", error)
    return getErrorMessage(error)
  }
}

/* ---------------------------------------------
 * LOGIN
 * -------------------------------------------- */
export async function login(formData: FormData) {
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
      return "Login failed: Invalid authentication response"
    }

    logger.info("[login] Token received, length:", token.length)
    await setAuthToken(token)

    const customerCacheTag = await getCacheTag("customers")
    revalidateTag(customerCacheTag)
  } catch (error) {
    logger.error("Login error:", error)
    return getErrorMessage(error)
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
