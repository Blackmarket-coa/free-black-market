import { describe, expect, it } from "vitest"

import { describeVaultStatus, resolveVaultStatus } from "./vault-status"

const now = new Date("2026-07-01T12:00:00.000Z")
const daysFromNow = (days: number) =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

describe("resolveVaultStatus", () => {
  it("trusts the API's derived fields when present", () => {
    expect(
      resolveVaultStatus(
        { verified: true, effective_status: "expired", days_until_expiry: -3 },
        now
      )
    ).toEqual({ status: "expired", daysUntilExpiry: -3 })
  })

  it("derives from the row when the API fields are absent", () => {
    expect(resolveVaultStatus({ verified: false }, now)).toEqual({
      status: "unverified",
      daysUntilExpiry: null,
    })
    expect(resolveVaultStatus({ verified: true, expires_at: daysFromNow(-1) }, now)).toEqual({
      status: "expired",
      daysUntilExpiry: -1,
    })
    expect(resolveVaultStatus({ verified: true, expires_at: daysFromNow(10) }, now)).toEqual({
      status: "verified",
      daysUntilExpiry: 10,
    })
  })

  it("treats an unparseable expiry as open-ended", () => {
    expect(resolveVaultStatus({ verified: true, expires_at: "not a date" }, now)).toEqual({
      status: "verified",
      daysUntilExpiry: null,
    })
  })
})

describe("describeVaultStatus", () => {
  it("never shows a lapsed document as verified", () => {
    expect(
      describeVaultStatus({ verified: true, effective_status: "expired", days_until_expiry: -40 }, now)
    ).toEqual({ label: "Expired", color: "red" })
  })

  it("labels the stored states", () => {
    expect(describeVaultStatus({ verified: false, effective_status: "unverified" }, now)).toEqual({
      label: "Unverified",
      color: "grey",
    })
    expect(
      describeVaultStatus({ verified: true, effective_status: "verified", days_until_expiry: 200 }, now)
    ).toEqual({ label: "Verified", color: "green" })
    expect(
      describeVaultStatus({ verified: true, effective_status: "verified", days_until_expiry: null }, now)
    ).toEqual({ label: "Verified", color: "green" })
  })

  it("warns inside the expiry window", () => {
    expect(
      describeVaultStatus({ verified: true, effective_status: "verified", days_until_expiry: 30 }, now)
    ).toEqual({ label: "Verified · expires in 30 days", color: "orange" })
    expect(
      describeVaultStatus({ verified: true, effective_status: "verified", days_until_expiry: 1 }, now)
    ).toEqual({ label: "Verified · expires in 1 day", color: "orange" })
    expect(
      describeVaultStatus({ verified: true, effective_status: "verified", days_until_expiry: 0 }, now)
    ).toEqual({ label: "Verified · expires today", color: "orange" })
  })
})
