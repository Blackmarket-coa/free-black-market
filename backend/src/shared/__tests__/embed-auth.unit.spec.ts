import { extractEmbedKey, originHostname, originAllowed } from "../embed-auth"

describe("embed-auth", () => {
  describe("extractEmbedKey", () => {
    it("accepts the canonical 'PublishableKey pk_live_…' form", () => {
      expect(extractEmbedKey("PublishableKey pk_live_abc123")).toBe("pk_live_abc123")
    })
    it("accepts a bare pk_live_ value", () => {
      expect(extractEmbedKey("pk_live_abc123")).toBe("pk_live_abc123")
    })
    it("rejects other schemes / malformed values", () => {
      expect(extractEmbedKey("Bearer xyz")).toBeNull()
      expect(extractEmbedKey("pk_test_abc")).toBeNull()
      expect(extractEmbedKey(undefined)).toBeNull()
      expect(extractEmbedKey("")).toBeNull()
    })
  })

  describe("originHostname", () => {
    it("reduces a full URL to a bare host (no www, no port)", () => {
      expect(originHostname("https://www.shop.example.com:443/path")).toBe("shop.example.com")
    })
    it("falls back for a bare host string", () => {
      expect(originHostname("shop.example.com")).toBe("shop.example.com")
    })
    it("returns null for empty input", () => {
      expect(originHostname("")).toBeNull()
      expect(originHostname(null)).toBeNull()
    })
  })

  describe("originAllowed", () => {
    const domains = ["shop.example.com", "other.test"]
    it("allows a matching origin (ignoring www/port)", () => {
      expect(originAllowed("https://www.shop.example.com", domains)).toBe(true)
      expect(originAllowed("https://shop.example.com:8443", domains)).toBe(true)
    })
    it("denies a non-listed origin", () => {
      expect(originAllowed("https://evil.example.com", domains)).toBe(false)
    })
    it("denies when domains is missing/not an array", () => {
      expect(originAllowed("https://shop.example.com", null)).toBe(false)
      expect(originAllowed("https://shop.example.com", undefined)).toBe(false)
    })
    it("denies an empty origin", () => {
      expect(originAllowed("", domains)).toBe(false)
    })
  })
})
