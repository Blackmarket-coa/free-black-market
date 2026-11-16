import type { FetchError } from "@medusajs/js-sdk"
import type { HttpTypes } from "@medusajs/types"
import type { UseMutationOptions} from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query"
import { sdk } from "@lib/client"
import { registerOrSignIn } from "@lib/register-or-sign-in"

export const useSignInWithEmailPass = (
  options?: UseMutationOptions<
    | string
    | {
        location: string
      },
    FetchError,
    HttpTypes.AdminSignUpWithEmailPassword
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.auth.login("user", "emailpass", {
      ...payload,
      email: payload.email.toLowerCase().trim(),
    }),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useSignUpWithEmailPass = (
  options?: UseMutationOptions<
    string,
    FetchError,
    HttpTypes.AdminSignInWithEmailPassword
  >
) => {
  return useMutation({
    // Used by the invite page. When the address already has a login, signs in
    // to it with the password typed instead, and a wrong password rejects with
    // `ExistingAccountError` (see lib/register-or-sign-in.ts).
    mutationFn: (payload) => {
      // Strip unsupported fields before calling auth.register
      const { vendor_type: _vendor_type, confirmPassword: _confirmPassword, ...authPayload } = payload as any

return registerOrSignIn(sdk.auth, "user", {
        ...authPayload,
        email: payload.email.toLowerCase().trim(),
      })
    },
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useResetPasswordForEmailPass = (
  options?: UseMutationOptions<void, FetchError, { email: string }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.resetPassword("user", "emailpass", {
        identifier: payload.email.toLowerCase().trim(),
      }),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useLogout = (options?: UseMutationOptions<void, FetchError>) => {
  return useMutation({
    mutationFn: () => sdk.auth.logout(),
    ...options,
  })
}

export const useUpdateProviderForEmailPass = (
  token: string,
  options?: UseMutationOptions<void, FetchError, HttpTypes.AdminUpdateProvider>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.updateProvider("user", "emailpass", payload, token),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
