import { FetchError, type FetchArgs } from "@medusajs/js-sdk"
import { clearAuthToken, isPublicAuthRoute, sdk as panelSdk } from "./client"

/**
 * The client the invoicing, POS, farm, cottage-food, digital-products and
 * bug-report screens import (SD-146).
 *
 * It was a second JS SDK built with `auth: { type: "session" }`. The SDK sends
 * no Authorization header for a session client, and the panel never makes a
 * session: it signs sellers in with JWTs. Mercur's vendor gate reads only the
 * bearer, so every `/vendor` call made through it was refused.
 *
 * It is now the panel's own JWT client from lib/client, which reads the token
 * from the panel's one store on every request: `localStorage` under
 * "medusa_auth_token", the SDK's default JWT key, which `setAuthToken` writes
 * at sign-in and `clearAuthToken` removes. The SDK does nothing on a 401, so
 * this does what `fetchQuery` does: a 401 from any route `isPublicAuthRoute`
 * does not exempt (sign-in and email verification) drops the token, and the
 * protected layout then sends the seller to sign in. The error is rethrown as
 * it came, a `FetchError` with its status, which the route ErrorBoundary and
 * the query client's retry rule read.
 */
export const sdk = {
  client: {
    fetch: async <T>(path: string, init?: FetchArgs): Promise<T> => {
      try {
        return await panelSdk.client.fetch<T>(path, init)
      } catch (error) {
        if (
          error instanceof FetchError &&
          error.status === 401 &&
          !isPublicAuthRoute(path)
        ) {
          clearAuthToken()
        }
        throw error
      }
    },
  },
}
