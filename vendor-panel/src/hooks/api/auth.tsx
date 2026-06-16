import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { UseMutationOptions, useMutation } from "@tanstack/react-query"
import {
  backendUrl,
  clearAuthToken,
  fetchQuery,
  getAuthToken,
  publicAuthSdk,
  sdk,
  setAuthToken,
} from "../../lib/client"
import { devLogger } from "../../lib/logger"

const fetchRegistrationStatus = async (token: string) => {
  const response = await fetch(`${backendUrl}/auth/seller/registration-status`, {
    method: "GET",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  return response.json() as Promise<{
    status: string
    message: string
    request_id?: string
    seller_id?: string
  }>
}

const normalizePassword = (password: unknown) => {
  if (typeof password !== "string") {
    throw new Error("Password should be a string.")
  }

  return password
}

/**
 * Best-effort map from a chosen playbook to the legacy `vendor_type`
 * value. `vendor_type` is now only a denormalized read-cache (the
 * playbook is the source of truth via `playbook_assignment`), so a lossy
 * mapping is fine. Mirrors the reverse of `LEGACY_VENDOR_TYPE_MAP` in
 * `playbook-provider/playbook-context.tsx`.
 */
const PLAYBOOK_TO_VENDOR_TYPE: Record<string, string> = {
  stall: "maker",
  atelier: "maker",
  workshop: "maker",
  service: "maker",
  grove: "mutual_aid",
  commons: "mutual_aid",
  hub: "mutual_aid",
  cycle: "producer",
  harvest: "garden",
  kitchen: "kitchen",
}

const playbookToVendorType = (playbook?: string): string | undefined =>
  playbook ? PLAYBOOK_TO_VENDOR_TYPE[playbook] : undefined

/**
 * Sign in with email/password
 */
export const useSignInWithEmailPass = (
  options?: UseMutationOptions<
    | string
    | { location: string },
    FetchError,
    HttpTypes.AdminSignUpWithEmailPassword
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      const normalizedPassword = normalizePassword(payload.password)
      const result = await publicAuthSdk.auth.login("seller", "emailpass", {
        ...payload,
        email: payload.email.toLowerCase().trim(),
        password: normalizedPassword,
      })
      if (typeof result === "string") setAuthToken(result)
      return result
    },
    ...options,
  })
}

/**
 * Sign up with email/password and create vendor registration
 */
export const useSignUpWithEmailPass = (
  options?: UseMutationOptions<
    string,
    FetchError,
    HttpTypes.AdminSignInWithEmailPassword & {
      confirmPassword: string
      name: string
      vendor_type?: string
      playbook?: string
      recommended_playbook?: string
      resources?: string[]
    }
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      const {
        confirmPassword,
        vendor_type,
        playbook,
        recommended_playbook,
        resources,
        ...authPayload
      } = payload
      const normalizedEmail = payload.email.toLowerCase().trim()
      const normalizedPassword = normalizePassword(payload.password)

      try {
        const token = await sdk.auth.register("seller", "emailpass", {
          ...authPayload,
          email: normalizedEmail,
          password: normalizedPassword,
        })

        if (typeof token === "string") setAuthToken(token)
        return token
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Registration failed"
        const status =
          error instanceof FetchError ? error.status : undefined

        if (status === 409 || message.toLowerCase().includes("already exists")) {
          const result = await sdk.auth.login("seller", "emailpass", {
            ...authPayload,
            email: normalizedEmail,
            password: normalizedPassword,
          })
          if (typeof result === "string") {
            setAuthToken(result)
            return result
          }
        }

        throw error
      }
    },
    onSuccess: async (data, variables, context) => {
      try {
        const token = typeof data === "string" ? data : getAuthToken()
        if (token) {
          const status = await fetchRegistrationStatus(token)
          if (status.status === "pending" || status.status === "approved") {
            options?.onSuccess?.(data, variables, context)
            return
          }
        }

        await fetchQuery("/auth/seller/register-request", {
          method: "POST",
          body: {
            name: variables.name,
            vendor_type:
              variables.vendor_type ||
              playbookToVendorType(variables.playbook) ||
              "producer",
            playbook: variables.playbook,
            recommended_playbook: variables.recommended_playbook,
            resources: variables.resources,
            member: {
              name: variables.name,
              email: variables.email.toLowerCase().trim(),
            },
          },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
      } catch (error) {
        devLogger.error(
          "Failed to create seller registration request:",
          error
        )
      }

      // Call user's onSuccess callback if provided
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * Sign up for invite flow (no vendor type)
 */
export const useSignUpForInvite = (
  options?: UseMutationOptions<string, FetchError, HttpTypes.AdminSignInWithEmailPassword>
) => {
  return useMutation({
    mutationFn: async (payload) => {
      const normalizedPassword = normalizePassword(payload.password)
      const token = await publicAuthSdk.auth.register("seller", "emailpass", {
        ...payload,
        email: payload.email.toLowerCase().trim(),
        password: normalizedPassword,
      })
      if (typeof token === "string") setAuthToken(token)
      return token
    },
    ...options,
  })
}

/**
 * Reset password for email/password
 */
export const useResetPasswordForEmailPass = (
  options?: UseMutationOptions<void, FetchError, { email: string }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.resetPassword("seller", "emailpass", {
        identifier: payload.email.toLowerCase().trim(),
      }),
    ...options,
  })
}

/**
 * Logout
 */
export const useLogout = (options?: UseMutationOptions<void, FetchError>) => {
  return useMutation({
    mutationFn: async () => {
      await sdk.auth.logout()
      clearAuthToken()
    },
    ...options,
  })
}

/**
 * Update provider password for email/password
 */
export const useUpdateProviderForEmailPass = (
  token: string,
  options?: UseMutationOptions<void, FetchError, { password: string }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.updateProvider("seller", "emailpass", payload, token),
    ...options,
  })
}
