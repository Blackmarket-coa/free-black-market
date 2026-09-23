import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  clearConsent,
  hasTrackingConsent,
  parseConsent,
  readConsent,
  serializeConsent,
  serializeConsentRemoval,
  setConsent,
} from "../consent"

/**
 * A `document.cookie`-shaped stub: the setter records every assignment, the
 * getter returns whatever the test seeded. Enough to observe what the
 * browser helpers write without a DOM.
 */
const stubDocument = (cookie = "") => {
  const writes: string[] = []
  vi.stubGlobal("document", {
    get cookie() {
      return cookie
    },
    set cookie(value: string) {
      writes.push(value)
    },
  })
  return writes
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseConsent", () => {
  it("accepts only the two known choices", () => {
    expect(parseConsent("accepted")).toBe("accepted")
    expect(parseConsent("essential")).toBe("essential")
    expect(parseConsent(" accepted ")).toBe("accepted")
  })

  it("rejects anything else", () => {
    expect(parseConsent("yes")).toBeNull()
    expect(parseConsent("")).toBeNull()
    expect(parseConsent(null)).toBeNull()
    expect(parseConsent(undefined)).toBeNull()
  })
})

describe("readConsent", () => {
  it("parses a raw cookie header string", () => {
    expect(
      readConsent(`_medusa_cache_id=abc; ${CONSENT_COOKIE}=accepted; aff=x`)
    ).toBe("accepted")
    expect(readConsent(`${CONSENT_COOKIE}=essential`)).toBe("essential")
    expect(readConsent("_medusa_cache_id=abc")).toBeNull()
    expect(readConsent("")).toBeNull()
  })

  it("does not match a cookie whose name merely ends with the consent name", () => {
    expect(readConsent(`x_${CONSENT_COOKIE}=accepted`)).toBeNull()
  })

  it("reads a Next-style cookie store (`get` returning `{ value }`)", () => {
    const store = {
      get: (name: string) =>
        name === CONSENT_COOKIE ? { name, value: "accepted" } : undefined,
    }
    expect(readConsent(store)).toBe("accepted")
    expect(readConsent({ get: () => undefined })).toBeNull()
  })

  it("reads a Map-like store returning the string itself", () => {
    expect(readConsent(new Map([[CONSENT_COOKIE, "essential"]]))).toBe(
      "essential"
    )
  })

  it("treats null and unknown values as no choice", () => {
    expect(readConsent(null)).toBeNull()
    expect(readConsent({ get: () => ({ value: "garbage" }) })).toBeNull()
  })

  it("falls back to document.cookie in the browser and to null on the server", () => {
    expect(readConsent()).toBeNull()
    stubDocument(`${CONSENT_COOKIE}=accepted`)
    expect(readConsent()).toBe("accepted")
  })
})

describe("hasTrackingConsent", () => {
  it("is true only for an explicit accept", () => {
    expect(hasTrackingConsent(`${CONSENT_COOKIE}=accepted`)).toBe(true)
    expect(hasTrackingConsent(`${CONSENT_COOKIE}=essential`)).toBe(false)
    expect(hasTrackingConsent("")).toBe(false)
    expect(hasTrackingConsent(null)).toBe(false)
  })
})

describe("serializeConsent", () => {
  it("writes a 180-day, Lax, root-path cookie", () => {
    expect(CONSENT_MAX_AGE_SECONDS).toBe(180 * 24 * 60 * 60)
    expect(serializeConsent("accepted")).toBe(
      `${CONSENT_COOKIE}=accepted; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
    )
  })

  it("adds Secure only when asked", () => {
    expect(serializeConsent("essential", { secure: true })).toBe(
      `${CONSENT_COOKIE}=essential; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`
    )
    expect(serializeConsent("essential", { secure: false })).not.toContain(
      "Secure"
    )
  })

  it("round-trips through readConsent", () => {
    expect(readConsent(serializeConsent("accepted"))).toBe("accepted")
    expect(readConsent(serializeConsent("essential"))).toBe("essential")
  })

  it("serializes a removal as an expired cookie", () => {
    expect(serializeConsentRemoval()).toBe(
      `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`
    )
    expect(serializeConsentRemoval({ secure: true })).toContain("; Secure")
  })
})

describe("setConsent / clearConsent", () => {
  it("are no-ops without a document", () => {
    expect(() => setConsent("accepted")).not.toThrow()
    expect(() => clearConsent()).not.toThrow()
  })

  it("write the serialized choice to document.cookie, Secure on https", () => {
    const writes = stubDocument()
    vi.stubGlobal("location", { protocol: "https:" })

    setConsent("accepted")
    setConsent("essential")
    clearConsent()

    expect(writes).toEqual([
      serializeConsent("accepted", { secure: true }),
      serializeConsent("essential", { secure: true }),
      serializeConsentRemoval({ secure: true }),
    ])
  })

  it("omit Secure on plain http", () => {
    const writes = stubDocument()
    vi.stubGlobal("location", { protocol: "http:" })

    setConsent("accepted")

    expect(writes).toEqual([serializeConsent("accepted", { secure: false })])
  })
})
