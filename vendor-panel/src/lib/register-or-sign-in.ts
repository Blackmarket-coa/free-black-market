import { FetchError } from "@medusajs/js-sdk"

/**
 * Registration answered that the address already has a login. The backend
 * gives Medusa's "Identity with email already exists" (401) for every taken
 * address (backend/src/api/middlewares/refuse-taken-email-registration.ts); a
 * 409 counts too. This is the check the sign-up has always made, shared so the
 * sign-up and the invite page agree on it.
 */
export const isTakenEmailError = (error: unknown): boolean => {
  const status = error instanceof FetchError ? error.status : undefined
  const message = error instanceof Error ? error.message : ""
  return status === 409 || message.toLowerCase().includes("already exists")
}

/**
 * What to tell an applicant whose filing (`POST /auth/seller/register-request`)
 * failed, so the sign-up shows it instead of its success screen. Reads the
 * `details` that `fetchQuery` attaches; a network failure has none.
 *
 * - 409: the backend's message (a taken store name, or a login that already
 *   has a store), which is theirs to act on.
 * - 429: the auth limiter, which every sign-up from the same network shares.
 * - another 4xx with a message: that message.
 * - anything else (5xx, network): the account exists and pressing again files.
 */
export const filingFailureMessage = (error: unknown): string => {
  const details = (error as { details?: { status?: number; backendMessage?: string | null } } | null)
    ?.details
  const status = details?.status
  const backendMessage = details?.backendMessage?.trim()
  if (status === 409) {
    return backendMessage || "This store could not be registered. Choose another store name."
  }
  if (status === 429) {
    return "Too many sign-up attempts from your network just now. Wait a minute, then press the button again."
  }
  if (status !== undefined && status >= 400 && status < 500 && backendMessage) {
    return backendMessage
  }
  return "Your account was created, but your application could not be filed. Press the button again to finish."
}

type RegistrationStatus = { status?: string } | null

/**
 * The sign-up's last step: file the application, unless the login already has
 * one pending or a store. Resolves only then, or when the filing answered 2xx
 * (201 filed, 200 already pending); otherwise rejects with
 * `filingFailureMessage`, so the success screen never stands over an
 * application that was not filed. A status check that fails is not a reason
 * to skip filing. Pressing the button again signs in and gets here again.
 */
export async function finishSellerSignUp(steps: {
  status: () => Promise<RegistrationStatus>
  file: () => Promise<unknown>
}): Promise<"filed" | "already"> {
  const current = await steps.status().catch(() => null)
  if (current?.status === "pending" || current?.status === "approved") {
    return "already"
  }
  try {
    await steps.file()
  } catch (error) {
    throw new Error(filingFailureMessage(error))
  }
  return "filed"
}

/** The address has a login, and the password typed is not its password. */
export class ExistingAccountError extends Error {
  constructor() {
    super("An account with this email already exists")
    this.name = "ExistingAccountError"
  }
}

type Credentials = { email: string; password: string }

/** The part of the JS SDK's `auth` this needs, so a spec can pass a fake. */
export type EmailPassAuth = {
  register: (actor: string, method: string, payload: Credentials) => Promise<string>
  login: (
    actor: string,
    method: string,
    payload: Credentials
  ) => Promise<string | { location: string }>
}

/**
 * A token for the login an invite is accepted with: a new login, or, when the
 * address already has one, that login signed in to with the password typed.
 *
 * Registration no longer takes over an existing login (it used to replace the
 * password of one with no actor, which is how an invitee whose address had
 * such a login got through), and the invite accept routes take a login token
 * with no actor. A wrong password for the existing login is an
 * `ExistingAccountError`, so the page can say what to do; any other failure
 * is passed on as it came.
 */
export async function registerOrSignIn(
  auth: EmailPassAuth,
  actor: string,
  credentials: Credentials
): Promise<string> {
  try {
    return await auth.register(actor, "emailpass", credentials)
  } catch (error) {
    if (!isTakenEmailError(error)) {
      throw error
    }
  }

  let signedIn: string | { location: string }
  try {
    signedIn = await auth.login(actor, "emailpass", credentials)
  } catch (error) {
    if (error instanceof FetchError && error.status === 401) {
      throw new ExistingAccountError()
    }
    throw error
  }

  if (typeof signedIn !== "string") {
    throw new ExistingAccountError()
  }
  return signedIn
}
