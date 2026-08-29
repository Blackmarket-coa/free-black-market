import { parseSemver, compareSemver, isInstallable } from "../compat"

describe("parseSemver", () => {
  it("parses X.Y.Z, tolerating a leading v and pre-release/build suffixes", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseSemver("v2.0.0")).toEqual({ major: 2, minor: 0, patch: 0 })
    expect(parseSemver("1.4.0-beta.1")).toEqual({ major: 1, minor: 4, patch: 0 })
    expect(parseSemver("1.4.0+build9")).toEqual({ major: 1, minor: 4, patch: 0 })
  })

  it("returns null for unparseable / missing input", () => {
    expect(parseSemver("1.2")).toBeNull()
    expect(parseSemver("nope")).toBeNull()
    expect(parseSemver(null)).toBeNull()
    expect(parseSemver(undefined)).toBeNull()
  })
})

describe("compareSemver", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1)
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1)
    expect(compareSemver("1.0.5", "1.0.5")).toBe(0)
    expect(compareSemver("1.0.10", "1.0.2")).toBe(1)
  })

  it("returns null when either side is unparseable", () => {
    expect(compareSemver("1.0.0", "bad")).toBeNull()
    expect(compareSemver(null, "1.0.0")).toBeNull()
  })
})

describe("isInstallable", () => {
  it("allows a plugin with no bounds", () => {
    expect(isInstallable({ status: "PUBLISHED" }, "1.0.0")).toEqual({ ok: true })
    expect(isInstallable({}, "3.5.2")).toEqual({ ok: true })
  })

  it("blocks deprecated plugins regardless of version", () => {
    const r = isInstallable({ status: "DEPRECATED" }, "1.0.0")
    expect(r).toMatchObject({ ok: false, code: "deprecated" })
  })

  it("blocks when the host is below min_host_version", () => {
    const r = isInstallable({ min_host_version: "2.0.0" }, "1.5.0")
    expect(r).toMatchObject({ ok: false, code: "incompatible" })
  })

  it("blocks when the host is above max_host_version", () => {
    const r = isInstallable({ max_host_version: "1.0.0" }, "2.0.0")
    expect(r).toMatchObject({ ok: false, code: "incompatible" })
  })

  it("allows the host at the inclusive bounds", () => {
    expect(isInstallable({ min_host_version: "1.0.0", max_host_version: "2.0.0" }, "1.0.0")).toEqual({ ok: true })
    expect(isInstallable({ min_host_version: "1.0.0", max_host_version: "2.0.0" }, "2.0.0")).toEqual({ ok: true })
    expect(isInstallable({ min_host_version: "1.0.0", max_host_version: "2.0.0" }, "1.5.0")).toEqual({ ok: true })
  })

  it("fails open on unparseable bounds (a bad catalog value can't wedge installs)", () => {
    expect(isInstallable({ min_host_version: "garbage" }, "1.0.0")).toEqual({ ok: true })
    expect(isInstallable({ max_host_version: "" }, "1.0.0")).toEqual({ ok: true })
  })
})

// --- W3 additions: prerelease-aware precedence + write validation ----------

import { compareSemverPrecedence, isValidSemverString } from "../compat"

describe("compareSemverPrecedence", () => {
  it("matches compareSemver on release-only comparisons", () => {
    expect(compareSemverPrecedence("1.2.3", "1.2.3")).toBe(0)
    expect(compareSemverPrecedence("1.2.3", "1.3.0")).toBe(-1)
    expect(compareSemverPrecedence("2.0.0", "1.9.9")).toBe(1)
  })

  it("orders prereleases below their release (SemVer §11)", () => {
    expect(compareSemverPrecedence("1.0.0-rc.1", "1.0.0")).toBe(-1)
    expect(compareSemverPrecedence("1.0.0", "1.0.0-rc.1")).toBe(1)
  })

  it("orders prerelease identifiers: numeric < alpha, numerics numerically, prefix loses", () => {
    expect(compareSemverPrecedence("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1)
    expect(compareSemverPrecedence("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1)
    expect(compareSemverPrecedence("1.0.0-alpha.beta", "1.0.0-beta")).toBe(-1)
    expect(compareSemverPrecedence("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1)
    expect(compareSemverPrecedence("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0)
  })

  it("ignores build metadata and keeps the fail-null contract", () => {
    expect(compareSemverPrecedence("1.0.0+build5", "1.0.0")).toBe(0)
    expect(compareSemverPrecedence("garbage", "1.0.0")).toBeNull()
    expect(compareSemverPrecedence("1.0.0", null)).toBeNull()
  })
})

describe("isValidSemverString", () => {
  it("accepts X.Y.Z with optional v prefix, prerelease and build suffixes", () => {
    for (const good of ["1.0.0", "v1.0.0", "1.0.0-rc.1", "1.0.0+build.5", "1.0.0-rc.1+b2"]) {
      expect(isValidSemverString(good)).toBe(true)
    }
  })

  it("tolerates surrounding whitespace (trimmed before matching)", () => {
    expect(isValidSemverString("1.0.0 ")).toBe(true)
    expect(isValidSemverString(" v2.1.0")).toBe(true)
  })

  it("rejects everything else", () => {
    for (const bad of [null, undefined, "", "1.0", "1", "latest", "1.0.0.0", "1.0.0-"]) {
      expect(isValidSemverString(bad as string)).toBe(false)
    }
  })
})
