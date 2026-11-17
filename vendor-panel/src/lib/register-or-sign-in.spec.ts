import { FetchError } from "@medusajs/js-sdk"
import { describe, expect, it, vi } from "vitest"

import {
  ExistingAccountError,
  filingFailureMessage,
  finishSellerSignUp,
  isTakenEmailError,
  registerOrSignIn,
  type EmailPassAuth,
} from "./register-or-sign-in"

/**
 * The invite page's login: registered, or, when the address already has a
 * login, signed in to. The backend answers every taken address with Medusa's
 * 401 "Identity with email already exists"
 * (backend/integration-tests/http/auth-register-taken-email.spec.ts pins it),
 * and no longer re-passwords a login with no actor, which is how an invitee
 * whose address had such a login used to get through.
 */

const credentials = { email: "grower@example.com", password: "Sup3r-secret" }
const taken = () => new FetchError("Identity with email already exists", "Unauthorized", 401)
const wrongPassword = () => new FetchError("Invalid email or password", "Unauthorized", 401)

const fakeAuth = (impl: Partial<EmailPassAuth>) => ({
  register: vi.fn<EmailPassAuth["register"]>(impl.register ?? (async () => "reg-token")),
  login: vi.fn<EmailPassAuth["login"]>(impl.login ?? (async () => "login-token")),
})

describe("registerOrSignIn", () => {
  it("returns the registration token for a new address, and does not sign in", async () => {
    const auth = fakeAuth({})
    await expect(registerOrSignIn(auth, "seller", credentials)).resolves.toBe("reg-token")
    expect(auth.register).toHaveBeenCalledWith("seller", "emailpass", credentials)
    expect(auth.login).not.toHaveBeenCalled()
  })

  it("signs in with the same email and password when the address already has a login", async () => {
    const auth = fakeAuth({
      register: async () => {
        throw taken()
      },
    })
    await expect(registerOrSignIn(auth, "seller", credentials)).resolves.toBe("login-token")
    expect(auth.login).toHaveBeenCalledWith("seller", "emailpass", credentials)
  })

  it("treats a 409 from registration as a taken address too", async () => {
    const auth = fakeAuth({
      register: async () => {
        throw new FetchError("Conflict", "Conflict", 409)
      },
    })
    await expect(registerOrSignIn(auth, "seller", credentials)).resolves.toBe("login-token")
  })

  it("says the account exists when the password is not that login's", async () => {
    const auth = fakeAuth({
      register: async () => {
        throw taken()
      },
      login: async () => {
        throw wrongPassword()
      },
    })
    await expect(registerOrSignIn(auth, "seller", credentials)).rejects.toBeInstanceOf(
      ExistingAccountError
    )
  })

  it("passes on a sign-in failure that is not a wrong password", async () => {
    const limited = new FetchError("Too many requests", "Too Many Requests", 429)
    const auth = fakeAuth({
      register: async () => {
        throw taken()
      },
      login: async () => {
        throw limited
      },
    })
    await expect(registerOrSignIn(auth, "seller", credentials)).rejects.toBe(limited)
  })

  it("passes on any other registration failure, and does not sign in", async () => {
    const invalid = new FetchError("Invalid email format", "Bad Request", 400)
    const auth = fakeAuth({
      register: async () => {
        throw invalid
      },
    })
    await expect(registerOrSignIn(auth, "seller", credentials)).rejects.toBe(invalid)
    expect(auth.login).not.toHaveBeenCalled()
  })
})

const latinRequired =
  "A store name needs at least one Latin letter or digit, which the store's web address uses."

// The shape fetchQuery throws (lib/client/client.ts).
const failed = (status: number, backendMessage: string | null) =>
  Object.assign(new Error(`${backendMessage} (POST /auth/seller/register-request (${status}))`), {
    details: { status, backendMessage },
  })

describe("filingFailureMessage", () => {
  it("passes on the backend's message for a 409: a taken store name, or a login that has a store", () => {
    const taken = 'A store named "Sunny Farm" already exists. Choose another store name.'
    expect(filingFailureMessage(failed(409, taken))).toBe(taken)
    expect(filingFailureMessage(failed(409, null))).toMatch(/Choose another store name/)
  })

  it("names the shared limiter for a 429", () => {
    expect(filingFailureMessage(failed(429, "Too many requests, please try again later"))).toMatch(/Wait a minute/)
  })

  it("passes on another 4xx's message", () => {
    expect(filingFailureMessage(failed(400, "Seller name is required"))).toBe("Seller name is required")
    // A store name whose web address would have no letter or digit, such as
    // «Ферма Два» (backend/src/shared/store-handle.ts STORE_NAME_NEEDS_LATIN).
    expect(filingFailureMessage(failed(400, latinRequired))).toBe(latinRequired)
    expect(filingFailureMessage(failed(401, "Create your account or sign in before applying to sell."))).toBe(
      "Create your account or sign in before applying to sell."
    )
  })

  it("says the account exists and pressing again finishes, for a 5xx or a network failure", () => {
    for (const error of [failed(500, "Internal error"), failed(503, null), new TypeError("Failed to fetch"), undefined]) {
      expect(filingFailureMessage(error)).toMatch(/Press the button again to finish/)
    }
  })
})

describe("finishSellerSignUp", () => {
  const steps = (status: unknown, file: () => Promise<unknown>) => ({
    status: vi.fn(async () => {
      if (status instanceof Error) throw status
      return status as { status?: string } | null
    }),
    file: vi.fn(file),
  })

  it("files nothing when the login already has an application pending, or a store", async () => {
    for (const status of ["pending", "approved"]) {
      const s = steps({ status }, async () => ({}))
      await expect(finishSellerSignUp(s)).resolves.toBe("already")
      expect(s.file).not.toHaveBeenCalled()
    }
  })

  it("succeeds only when the filing answers 2xx", async () => {
    const s = steps({ status: "no_request" }, async () => ({ request: { id: "req_1" } }))
    await expect(finishSellerSignUp(s)).resolves.toBe("filed")
    expect(s.file).toHaveBeenCalledTimes(1)
  })

  it("still files when the status check fails", async () => {
    const s = steps(new TypeError("Failed to fetch"), async () => ({}))
    await expect(finishSellerSignUp(s)).resolves.toBe("filed")
  })

  it("fails with a message to show for any filing that does not answer 2xx", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [failed(409, 'A store named "Sunny Farm" already exists. Choose another store name.'), /Choose another store name/],
      [failed(429, "Too many requests"), /Wait a minute/],
      [failed(400, "Seller name is required"), /Seller name is required/],
      [failed(400, latinRequired), /needs at least one Latin letter or digit/],
      [failed(500, "Internal error"), /Press the button again to finish/],
      [new TypeError("Failed to fetch"), /Press the button again to finish/],
    ]
    for (const [error, message] of cases) {
      const s = steps({ status: "no_request" }, async () => {
        throw error
      })
      await expect(finishSellerSignUp(s)).rejects.toThrow(message)
    }
  })
})

describe("isTakenEmailError", () => {
  it("matches what the sign-up has always matched", () => {
    expect(isTakenEmailError(taken())).toBe(true)
    expect(isTakenEmailError(new FetchError("Conflict", "Conflict", 409))).toBe(true)
    expect(isTakenEmailError(new Error("Identity with email already exists"))).toBe(true)
    expect(isTakenEmailError(wrongPassword())).toBe(false)
    expect(isTakenEmailError(new FetchError("Server error", "Internal Server Error", 500))).toBe(false)
    expect(isTakenEmailError("already exists")).toBe(false)
    expect(isTakenEmailError(undefined)).toBe(false)
  })
})
