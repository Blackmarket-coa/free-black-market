import { FetchError } from "@medusajs/js-sdk"
import { describe, expect, it, vi } from "vitest"

import {
  ExistingAccountError,
  isTakenEmailError,
  registerOrSignIn,
  type EmailPassAuth,
} from "./register-or-sign-in"

/**
 * The admin invite page's login: registered, or, when the address already has a
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
    await expect(registerOrSignIn(auth, "user", credentials)).resolves.toBe("reg-token")
    expect(auth.register).toHaveBeenCalledWith("user", "emailpass", credentials)
    expect(auth.login).not.toHaveBeenCalled()
  })

  it("signs in with the same email and password when the address already has a login", async () => {
    const auth = fakeAuth({
      register: async () => {
        throw taken()
      },
    })
    await expect(registerOrSignIn(auth, "user", credentials)).resolves.toBe("login-token")
    expect(auth.login).toHaveBeenCalledWith("user", "emailpass", credentials)
  })

  it("treats a 409 from registration as a taken address too", async () => {
    const auth = fakeAuth({
      register: async () => {
        throw new FetchError("Conflict", "Conflict", 409)
      },
    })
    await expect(registerOrSignIn(auth, "user", credentials)).resolves.toBe("login-token")
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
    await expect(registerOrSignIn(auth, "user", credentials)).rejects.toBeInstanceOf(
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
    await expect(registerOrSignIn(auth, "user", credentials)).rejects.toBe(limited)
  })

  it("passes on any other registration failure, and does not sign in", async () => {
    const invalid = new FetchError("Invalid email format", "Bad Request", 400)
    const auth = fakeAuth({
      register: async () => {
        throw invalid
      },
    })
    await expect(registerOrSignIn(auth, "user", credentials)).rejects.toBe(invalid)
    expect(auth.login).not.toHaveBeenCalled()
  })
})

describe("isTakenEmailError", () => {
  it("matches the vendor panel's sign-up check", () => {
    expect(isTakenEmailError(taken())).toBe(true)
    expect(isTakenEmailError(new FetchError("Conflict", "Conflict", 409))).toBe(true)
    expect(isTakenEmailError(new Error("Identity with email already exists"))).toBe(true)
    expect(isTakenEmailError(wrongPassword())).toBe(false)
    expect(isTakenEmailError(new FetchError("Server error", "Internal Server Error", 500))).toBe(false)
    expect(isTakenEmailError("already exists")).toBe(false)
    expect(isTakenEmailError(undefined)).toBe(false)
  })
})
