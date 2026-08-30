import { parseMxid, pickMxid, shouldWriteMxid } from "../oidc-mxid"

describe("parseMxid", () => {
  it("accepts a full mxid and extracts the localpart", () => {
    expect(parseMxid("@ibis:blackout.test")).toEqual({
      mxid: "@ibis:blackout.test",
      localpart: "ibis",
    })
    expect(parseMxid("  @b7k2:matrix.example.com  ")).toEqual({
      mxid: "@b7k2:matrix.example.com",
      localpart: "b7k2",
    })
  })

  it("rejects non-mxid shapes", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "ibis",
      "@ibis",
      "ibis:server",
      "@:server",
      "@a b:server",
      "@a:with space",
      "@@a:server",
    ]) {
      expect(parseMxid(bad)).toBeNull()
    }
  })
})

describe("pickMxid", () => {
  it("prefers a valid OIDC-provided mxid", () => {
    expect(pickMxid({ oidcMxid: "@ibis:blackout.test", email: "someone@example.com" })).toEqual({
      source: "oidc",
      mxid: "@ibis:blackout.test",
      localpart: "ibis",
    })
  })

  it("falls back to the email local part when there is no usable OIDC mxid", () => {
    expect(pickMxid({ email: "someone@example.com" })).toEqual({
      source: "derived",
      localpart: "someone",
    })
    expect(pickMxid({ oidcMxid: "not-an-mxid", email: "a.b@example.com" })).toEqual({
      source: "derived",
      localpart: "a.b",
    })
  })
})

describe("shouldWriteMxid", () => {
  it("writes when nothing is stored yet", () => {
    expect(shouldWriteMxid(undefined, "derived")).toBe(true)
    expect(shouldWriteMxid(null, "oidc")).toBe(true)
    expect(shouldWriteMxid({}, "derived")).toBe(true)
    expect(shouldWriteMxid({ mxid: "" }, "derived")).toBe(true)
  })

  it("keeps derived write-once: never overwrites an existing mxid", () => {
    expect(shouldWriteMxid({ mxid: "@a:s", mxid_source: "derived" }, "derived")).toBe(false)
    expect(shouldWriteMxid({ mxid: "@a:s", mxid_source: "oidc" }, "derived")).toBe(false)
    // Legacy rows have no mxid_source; derived still must not clobber them.
    expect(shouldWriteMxid({ mxid: "@a:s" }, "derived")).toBe(false)
  })

  it("treats oidc as authoritative: replaces derived, legacy and prior oidc values", () => {
    expect(shouldWriteMxid({ mxid: "@a:s", mxid_source: "derived" }, "oidc")).toBe(true)
    expect(shouldWriteMxid({ mxid: "@a:s" }, "oidc")).toBe(true)
    expect(shouldWriteMxid({ mxid: "@a:s", mxid_source: "oidc" }, "oidc")).toBe(true)
  })
})
