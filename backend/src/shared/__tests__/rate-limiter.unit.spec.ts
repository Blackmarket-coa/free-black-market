import { clientIp } from "../rate-limiter"

describe("clientIp", () => {
  it("prefers req.ip (Express-derived, honours trust proxy)", () => {
    const req: any = {
      ip: "203.0.113.5",
      socket: { remoteAddress: "10.0.0.1" },
      headers: { "x-forwarded-for": "1.2.3.4" },
    }
    expect(clientIp(req)).toBe("203.0.113.5")
  })

  it("never trusts a raw X-Forwarded-For header directly", () => {
    const req: any = {
      ip: undefined,
      socket: { remoteAddress: "198.51.100.9" },
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    }
    // Falls back to the socket address, NOT the spoofable header.
    expect(clientIp(req)).toBe("198.51.100.9")
  })

  it("falls back to 'unknown' when nothing is available", () => {
    expect(clientIp({ headers: {} } as any)).toBe("unknown")
  })
})
