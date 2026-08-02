import { describe, expect, it } from "vitest"
import { classifySessionError, SessionFetchError } from "./session-error"

const err = (status?: number): SessionFetchError =>
  Object.assign(new Error("boom"), { status })

describe("classifySessionError", () => {
  it("returns null when there is no error", () => {
    expect(classifySessionError(null)).toBeNull()
    expect(classifySessionError(undefined)).toBeNull()
  })

  it("asks for re-authentication only on 401", () => {
    expect(classifySessionError(err(401))).toBe("reauthenticate")
  })

  it("treats seller-profile-missing (404) as unavailable, not a login problem", () => {
    expect(classifySessionError(err(404))).toBe("unavailable")
  })

  it("treats server errors as unavailable", () => {
    expect(classifySessionError(err(500))).toBe("unavailable")
    expect(classifySessionError(err(503))).toBe("unavailable")
  })

  it("treats network failures (no status) as unavailable", () => {
    expect(classifySessionError(err(undefined))).toBe("unavailable")
  })
})
