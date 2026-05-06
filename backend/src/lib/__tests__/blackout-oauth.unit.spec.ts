import {
  issueBlackoutToken,
  verifyBlackoutCredentials,
  verifyBlackoutToken,
  isBlackoutIntegrationEnabled,
} from "../blackout-oauth"

describe("blackout-oauth", () => {
  const ORIG_ENV = { ...process.env }

  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.JWT_SECRET = "x".repeat(32)
    process.env.BLACKOUT_CLIENT_ID = "blackout-client"
    process.env.BLACKOUT_CLIENT_SECRET = "y".repeat(32)
  })

  afterAll(() => {
    process.env = ORIG_ENV
  })

  it("isBlackoutIntegrationEnabled reflects the flag", () => {
    process.env.FBM_BLACKOUT_INTEGRATION = "1"
    expect(isBlackoutIntegrationEnabled()).toBe(true)
    process.env.FBM_BLACKOUT_INTEGRATION = "0"
    expect(isBlackoutIntegrationEnabled()).toBe(false)
  })

  it("verifyBlackoutCredentials accepts the configured pair and rejects others", () => {
    expect(verifyBlackoutCredentials("blackout-client", "y".repeat(32))).toBe(true)
    expect(verifyBlackoutCredentials("blackout-client", "wrong")).toBe(false)
    expect(verifyBlackoutCredentials("other", "y".repeat(32))).toBe(false)
  })

  it("issued tokens round-trip through verifyBlackoutToken", () => {
    const token = issueBlackoutToken("blackout-client", 60)
    const claims = verifyBlackoutToken(token)
    expect(claims).not.toBeNull()
    expect(claims!.sub).toBe("blackout-client")
    expect(claims!.iss).toBe("fbm")
    expect(claims!.aud).toBe("blackout")
  })

  it("rejects tokens signed with a different secret", () => {
    const token = issueBlackoutToken("blackout-client", 60)
    process.env.JWT_SECRET = "different-secret-different-secret-different"
    expect(verifyBlackoutToken(token)).toBeNull()
  })
})
