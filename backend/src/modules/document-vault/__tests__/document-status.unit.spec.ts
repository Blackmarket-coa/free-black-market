import {
  daysUntilExpiry,
  effectiveDocumentStatus,
  isDocumentCurrent,
  isDocumentExpired,
} from "../document-status"

const at = (iso: string) => new Date(iso)
const now = at("2026-09-03T12:00:00Z")

describe("document-status: expiry", () => {
  it("never expires a document with no expiry date", () => {
    expect(isDocumentExpired({ verified: true, expires_at: null }, now)).toBe(false)
  })

  it("expires at the instant, not the calendar day", () => {
    // An insurance certificate states a time; end-of-day rounding would
    // extend it by up to a day.
    const doc = { verified: true, expires_at: at("2026-09-03T11:59:59Z") }
    expect(isDocumentExpired(doc, now)).toBe(true)
    expect(
      isDocumentExpired({ ...doc, expires_at: at("2026-09-03T12:00:01Z") }, now)
    ).toBe(false)
  })

  it("treats an unparseable expiry as open-ended rather than expired", () => {
    expect(isDocumentExpired({ verified: true, expires_at: "garbage" }, now)).toBe(false)
  })
})

describe("document-status: effective status", () => {
  it("is unverified until an admin has checked it, whatever the dates say", () => {
    expect(
      effectiveDocumentStatus({ verified: false, expires_at: at("2030-01-01T00:00:00Z") }, now)
    ).toBe("unverified")
    expect(effectiveDocumentStatus({ verified: null }, now)).toBe("unverified")
  })

  it("is verified while checked and in date", () => {
    expect(
      effectiveDocumentStatus({ verified: true, expires_at: at("2027-01-01T00:00:00Z") }, now)
    ).toBe("verified")
    expect(effectiveDocumentStatus({ verified: true, expires_at: null }, now)).toBe("verified")
  })

  it("is EXPIRED once the window closes, even though `verified` is still true", () => {
    // The bug the audit warned would become real the moment markVerified got
    // a caller: a lapsed certificate reading as current because nothing looked
    // at the date.
    expect(
      effectiveDocumentStatus({ verified: true, expires_at: at("2026-08-01T00:00:00Z") }, now)
    ).toBe("expired")
  })
})

describe("document-status: isDocumentCurrent", () => {
  it("is the only state that counts as evidence", () => {
    expect(isDocumentCurrent({ verified: true, expires_at: null }, now)).toBe(true)
    expect(
      isDocumentCurrent({ verified: true, expires_at: at("2026-01-01T00:00:00Z") }, now)
    ).toBe(false)
    expect(isDocumentCurrent({ verified: false, expires_at: null }, now)).toBe(false)
  })
})

describe("document-status: daysUntilExpiry", () => {
  it("counts whole days forward and backward, null when open-ended", () => {
    expect(daysUntilExpiry({ expires_at: at("2026-09-13T12:00:00Z") }, now)).toBe(10)
    expect(daysUntilExpiry({ expires_at: at("2026-09-01T12:00:00Z") }, now)).toBe(-2)
    expect(daysUntilExpiry({ expires_at: null }, now)).toBeNull()
  })
})
