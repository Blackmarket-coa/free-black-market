import { FetchError, type FetchArgs } from "@medusajs/js-sdk"
import {
  clearAuthToken,
  getAuthToken,
  isPublicAuthRoute,
  sdk as panelSdk,
} from "./client"

/**
 * The client the invoicing, POS, farm, cottage-food, digital-products and
 * bug-report screens import (SD-146).
 *
 * It was a second JS SDK built with `auth: { type: "session" }`. The SDK sends
 * no Authorization header for a session client, and the panel never makes a
 * session: it signs sellers in with JWTs. Mercur's vendor gate reads only the
 * bearer, so every `/vendor` call made through it was refused.
 *
 * It is now the panel's own JWT client from lib/client, and it sends what
 * `fetchQuery` sends: no token to a route `isPublicAuthRoute` exempts (sign-in
 * and email verification), and to any other route the token from the panel's
 * one store, `localStorage` under "medusa_auth_token", which `setAuthToken`
 * writes at sign-in and `clearAuthToken` removes. The token is read once per
 * request, before it is sent; a caller's own headers still win, as they do in
 * `fetchQuery`.
 *
 * The SDK does nothing on a 401, so this does what `fetchQuery` does: a 401
 * from a route that is not exempt drops the token, and the protected layout
 * then sends the seller to sign in. It drops it only if the stored token is
 * still the one this request carried: a sign-in that finished while the
 * request was in flight stored a newer token, which the 401 says nothing
 * about. Any other failure (another status, a network error, an abort, a 204
 * the SDK cannot parse as JSON) leaves the token alone. The error is rethrown
 * as it came, a `FetchError` with its status, which the route ErrorBoundary
 * and the query client's retry rule read.
 */
export const sdk = {
  client: {
    fetch: async <T>(path: string, init?: FetchArgs): Promise<T> => {
      const isPublic = isPublicAuthRoute(path)
      const token = isPublic ? "" : getAuthToken()
      try {
        return await panelSdk.client.fetch<T>(path, {
          ...init,
          // The SDK deletes a header whose value is null.
          headers: {
            Authorization: token ? `Bearer ${token}` : null,
            ...init?.headers,
          },
        })
      } catch (error) {
        if (
          !isPublic &&
          error instanceof FetchError &&
          error.status === 401 &&
          getAuthToken() === token
        ) {
          clearAuthToken()
        }
        throw error
      }
    },
  },
}
