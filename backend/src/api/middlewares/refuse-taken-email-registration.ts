import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * What Medusa answers on `POST /auth/:actor_type/emailpass/register` for an
 * address whose login has an actor: the route throws
 * `MedusaError(UNAUTHORIZED, "Identity with email already exists")`, which the
 * error handler sends as 401 with exactly this body. The storefront's sign-up
 * matches the message exactly (`isIdentityExists`, storefront/src/lib/data/
 * customer.ts) and the vendor panel's matches "already exists"
 * (`useSignUpWithEmailPass`); both then sign in with the typed password.
 */
export const TAKEN_EMAIL_RESPONSE = {
  type: "unauthorized",
  message: "Identity with email already exists",
} as const

/**
 * Refuses an emailpass registration for an address that already has a login.
 *
 * Medusa's emailpass provider (@medusajs/auth-emailpass, `register()`) treats
 * an existing login whose `app_metadata` is empty as "still claimable": it
 * replaces the password with the one in the body and returns a token for that
 * login. So anyone who knew the address of a login with no actor yet (every
 * vendor applicant until approval, a shopper whose sign-up stopped after the
 * login was made) could take it over, and the owner's password stopped
 * working (SD-127 follow-up, measured on Postgres).
 *
 * Every taken address now gets the answer Medusa already gives one whose login
 * has an actor. Whoever owns the login signs in with its password, or resets
 * it by email.
 *
 * Registered for POST on Medusa's own route shape,
 * `/auth/:actor_type/:auth_provider/register`, and decided on the decoded
 * `auth_provider` param, as Medusa's handler decides which provider to call.
 * Express matches a layer against the raw path and decodes only the params,
 * so a literal `emailpass` segment let `/auth/seller/%65mailpass/register`
 * past this check while Medusa's route still called the emailpass provider
 * (measured: the takeover went through). Lower-cased, because Express route
 * matching ignores case; Medusa's provider lookup does not, so `EMAILPASS`
 * fails there anyway.
 *
 * Medusa's RoutesSorter registers the `/auth/*` POST entry (a wildcard under
 * /auth) before this one (a param under /auth), and middlewares before the
 * route of the same shape, so the auth rate limiter has counted the call and
 * normalizeEmailMiddleware has lower-cased and checked the address: what is
 * looked up here is what the provider's `retrieve({ entity_id })` would look
 * up, an emailpass provider identity with exactly that entity_id. Without an
 * address it lets the call through for the provider to refuse.
 */
export async function refuseTakenEmailRegistration(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (String(req.params?.auth_provider ?? "").toLowerCase() !== "emailpass") {
    return next()
  }

  const email = (req.body as { email?: unknown } | undefined)?.email
  if (typeof email !== "string" || !email) {
    return next()
  }

  const existing = await req.scope
    .resolve(Modules.AUTH)
    .listProviderIdentities(
      { provider: "emailpass", entity_id: email },
      { select: ["id"], take: 1 }
    )

  if (existing.length > 0) {
    return res.status(401).json(TAKEN_EMAIL_RESPONSE)
  }
  return next()
}
