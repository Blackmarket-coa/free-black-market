import {
  readConsentFromCookieHeader,
  trackingConsented,
} from "../attribution-consent"

describe("readConsentFromCookieHeader", () => {
  it("is null with no cookie header", () => {
    expect(readConsentFromCookieHeader(undefined)).toBeNull()
    expect(readConsentFromCookieHeader("")).toBeNull()
  })

  it("is null when the consent cookie is absent", () => {
    expect(readConsentFromCookieHeader("_medusa_cache_id=abc; theme=dark")).toBeNull()
  })

  it("reads accepted and essential, wherever they sit in the header", () => {
    expect(readConsentFromCookieHeader("fbm_consent=accepted")).toBe("accepted")
    expect(readConsentFromCookieHeader("a=1; fbm_consent=essential; b=2")).toBe("essential")
    expect(readConsentFromCookieHeader("fbm_consent=accepted; a=1")).toBe("accepted")
  })

  it("treats any other value as no choice", () => {
    expect(readConsentFromCookieHeader("fbm_consent=yes")).toBeNull()
    expect(readConsentFromCookieHeader("fbm_consent=")).toBeNull()
    expect(readConsentFromCookieHeader("fbm_consent=%E0%A4%A")).toBeNull()
  })

  it("does not match a cookie whose name merely ends in the consent name", () => {
    expect(readConsentFromCookieHeader("xfbm_consent=accepted")).toBeNull()
  })
})

describe("trackingConsented", () => {
  it("is true only for an explicit accept", () => {
    expect(trackingConsented("fbm_consent=accepted")).toBe(true)
    expect(trackingConsented("fbm_consent=essential")).toBe(false)
    expect(trackingConsented(undefined)).toBe(false)
  })
})
