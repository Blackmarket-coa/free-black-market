import { isPlatformFileUrl, platformFileUrlBases } from "../platform-file-url"
import { proofOfDeliveryError } from "../../modules/food-distribution/proof-of-delivery"

/**
 * Proof-of-delivery evidence (`photo_url`, `signature_url`) is stored on the
 * delivery and served to its producer, courier and recipient. zod's
 * `.url()` accepts `javascript:`, `data:`, `file:` and `x:y`, so the proof
 * route only checked that the courier typed something URL-shaped. These pin
 * the narrower rule: an https URL under the base the configured file provider
 * serves uploads from, compared on the parsed URL.
 */

const MINIO = {
  MINIO_ENDPOINT: "minio",
  MINIO_ACCESS_KEY: "k",
  MINIO_SECRET_KEY: "s",
}

describe("platformFileUrlBases mirrors the file provider medusa-config selects", () => {
  it("MinIO with a public URL: <public url>/<bucket>/", () => {
    expect(
      platformFileUrlBases({ ...MINIO, MINIO_BUCKET: "medusa-media", MINIO_PUBLIC_URL: "https://media.fbm.test/" })
    ).toEqual(["https://media.fbm.test/medusa-media/"])
  })

  it("defaults the bucket as the provider does", () => {
    expect(platformFileUrlBases({ ...MINIO, MINIO_PUBLIC_URL: "https://media.fbm.test" })).toEqual([
      "https://media.fbm.test/medusa-media/",
    ])
  })

  it("MinIO without a public URL: the endpoint host, https unless MINIO_USE_SSL=false", () => {
    expect(platformFileUrlBases({ ...MINIO, MINIO_ENDPOINT: "s3.fbm.test", MINIO_BUCKET: "b" })).toEqual([
      "https://s3.fbm.test/b/",
    ])
    expect(
      platformFileUrlBases({ ...MINIO, MINIO_ENDPOINT: "s3.fbm.test", MINIO_BUCKET: "b", MINIO_USE_SSL: "false" })
    ).toEqual([])
    expect(platformFileUrlBases({ ...MINIO, MINIO_ENDPOINT: "http://s3.fbm.test:9000", MINIO_BUCKET: "b" })).toEqual(
      []
    )
  })

  it("the local provider: <BACKEND_URL>/static/, and nothing when that is not https", () => {
    expect(platformFileUrlBases({ BACKEND_URL: "https://api.fbm.test/" })).toEqual(["https://api.fbm.test/static/"])
    expect(platformFileUrlBases({ BACKEND_URL: "http://localhost:9000" })).toEqual([])
    expect(platformFileUrlBases({})).toEqual([])
  })

  it("MinIO wins over BACKEND_URL, as in medusa-config", () => {
    expect(
      platformFileUrlBases({ ...MINIO, MINIO_PUBLIC_URL: "https://media.fbm.test", BACKEND_URL: "https://api.fbm.test" })
    ).toEqual(["https://media.fbm.test/medusa-media/"])
  })
})

describe("isPlatformFileUrl", () => {
  const bases = ["https://media.fbm.test/medusa-media/"]

  it("accepts a file under the base", () => {
    expect(isPlatformFileUrl("https://media.fbm.test/medusa-media/01JX-porch.jpg", bases)).toBe(true)
    expect(isPlatformFileUrl("https://MEDIA.fbm.test:443/medusa-media/a/b.png", bases)).toBe(true)
  })

  it.each([
    ["x:y"],
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["file:///etc/passwd"],
    ["not a url"],
    ["http://media.fbm.test/medusa-media/p.jpg"],
    ["https://example.com/medusa-media/p.jpg"],
    ["https://media.fbm.test.evil.example/medusa-media/p.jpg"],
    ["https://media.fbm.test@evil.example/medusa-media/p.jpg"],
    ["https://user:pw@media.fbm.test/medusa-media/p.jpg"],
    ["https://media.fbm.test:8443/medusa-media/p.jpg"],
    ["https://media.fbm.test/other-bucket/p.jpg"],
    ["https://media.fbm.test/medusa-media-other/p.jpg"],
    ["https://media.fbm.test/medusa-media/../other-bucket/p.jpg"],
    ["https://media.fbm.test/medusa-media/%2e%2e/other-bucket/p.jpg"],
    ["https://media.fbm.test/medusa-media/"],
    ["https://media.fbm.test/medusa-media"],
  ])("refuses %s", (url) => {
    expect(isPlatformFileUrl(url, bases)).toBe(false)
  })

  it("accepts nothing when no https storage is configured", () => {
    expect(isPlatformFileUrl("https://media.fbm.test/medusa-media/p.jpg", [])).toBe(false)
  })
})

describe("proofOfDeliveryError", () => {
  const bases = ["https://media.fbm.test/medusa-media/"]

  it("refuses a requirement it does not know how to check", () => {
    expect(proofOfDeliveryError({ proof_type: "BIOMETRIC" }, { proof_type: "BIOMETRIC" }, bases)).toBe(
      "This delivery requires BIOMETRIC, which cannot be accepted here"
    )
  })

  it("checks evidence URLs on a delivery that requires no proof", () => {
    expect(proofOfDeliveryError({ proof_type: "NONE" }, { proof_type: "PHOTO" }, bases)).toBeNull()
    expect(
      proofOfDeliveryError({ proof_type: "NONE" }, { proof_type: "PHOTO", photo_url: "javascript:alert(1)" }, bases)
    ).toBe("photo_url must be an https URL of a file uploaded to this platform")
    expect(
      proofOfDeliveryError(
        { proof_type: "NONE" },
        { proof_type: "PHOTO", photo_url: "https://media.fbm.test/medusa-media/p.jpg" },
        bases
      )
    ).toBeNull()
  })
})
