import { hashIpForAttribution } from "../attribution-ip-hash"

const SALT = "a".repeat(64)
const OTHER_SALT = "b".repeat(64)
const IP = "203.0.113.7"
const OTHER_IP = "203.0.113.8"

describe("hashIpForAttribution", () => {
  const savedSalt = process.env.CREATOR_ATTRIBUTION_IP_SALT

  afterEach(() => {
    if (savedSalt === undefined) {
      delete process.env.CREATOR_ATTRIBUTION_IP_SALT
    } else {
      process.env.CREATOR_ATTRIBUTION_IP_SALT = savedSalt
    }
  })

  it("returns null without an ip", () => {
    expect(hashIpForAttribution(null, SALT)).toBeNull()
    expect(hashIpForAttribution(undefined, SALT)).toBeNull()
    expect(hashIpForAttribution("", SALT)).toBeNull()
  })

  it("returns null without a salt (never stores an unsalted hash)", () => {
    delete process.env.CREATOR_ATTRIBUTION_IP_SALT
    expect(hashIpForAttribution(IP)).toBeNull()
    expect(hashIpForAttribution(IP, undefined)).toBeNull()
    expect(hashIpForAttribution(IP, "")).toBeNull()
  })

  it("returns null with a whitespace-only salt", () => {
    expect(hashIpForAttribution(IP, "   ")).toBeNull()
    process.env.CREATOR_ATTRIBUTION_IP_SALT = " \t\n"
    expect(hashIpForAttribution(IP)).toBeNull()
  })

  it("returns 32 lowercase hex chars with a salt", () => {
    const out = hashIpForAttribution(IP, SALT)
    expect(out).toMatch(/^[0-9a-f]{32}$/)
  })

  it("is deterministic for the same salt and ip", () => {
    expect(hashIpForAttribution(IP, SALT)).toBe(hashIpForAttribution(IP, SALT))
  })

  it("differs across salts", () => {
    expect(hashIpForAttribution(IP, SALT)).not.toBe(
      hashIpForAttribution(IP, OTHER_SALT)
    )
  })

  it("differs across ips", () => {
    expect(hashIpForAttribution(IP, SALT)).not.toBe(
      hashIpForAttribution(OTHER_IP, SALT)
    )
  })

  it("uses the env salt by default and lets an explicit salt override it", () => {
    process.env.CREATOR_ATTRIBUTION_IP_SALT = SALT
    const fromEnv = hashIpForAttribution(IP)
    expect(fromEnv).toBe(hashIpForAttribution(IP, SALT))
    expect(hashIpForAttribution(IP, OTHER_SALT)).not.toBe(fromEnv)
    expect(hashIpForAttribution(IP, OTHER_SALT)).toBe(
      hashIpForAttribution(IP, OTHER_SALT)
    )
  })
})
