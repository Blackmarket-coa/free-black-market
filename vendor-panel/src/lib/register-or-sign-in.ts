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
