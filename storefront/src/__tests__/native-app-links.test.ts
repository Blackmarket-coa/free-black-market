import { describe, expect, it } from "vitest"
import {
  ANDROID_PACKAGE_NAME,
  buildAppleAppSiteAssociation,
  buildAssetLinks,
  parseAppleAppId,
  parseCertFingerprints,
} from "@/lib/native/app-links"

const FP =
  "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5"

describe("parseCertFingerprints", () => {
  it("parses one or more valid fingerprints", () => {
    expect(parseCertFingerprints(FP)).toEqual([FP])
    expect(parseCertFingerprints(` ${FP.toLowerCase()} , ${FP} `)).toEqual([
      FP,
      FP,
    ])
  })

  it("drops invalid entries and handles unset values", () => {
    expect(parseCertFingerprints(undefined)).toEqual([])
    expect(parseCertFingerprints("")).toEqual([])
    expect(parseCertFingerprints("AA:BB")).toEqual([])
    expect(parseCertFingerprints(`not-a-print,${FP}`)).toEqual([FP])
  })
})

describe("buildAssetLinks", () => {
  it("grants handle_all_urls to the shell package", () => {
    expect(buildAssetLinks([FP])).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: ANDROID_PACKAGE_NAME,
          sha256_cert_fingerprints: [FP],
        },
      },
    ])
  })
})

describe("parseAppleAppId", () => {
  it("accepts TEAMID.bundle.id", () => {
    expect(parseAppleAppId("AB12CD34EF.co.bmc.freeblackmarket")).toBe(
      "AB12CD34EF.co.bmc.freeblackmarket"
    )
  })

  it("rejects malformed ids", () => {
    expect(parseAppleAppId(undefined)).toBeNull()
    expect(parseAppleAppId("")).toBeNull()
    expect(parseAppleAppId("co.bmc.freeblackmarket")).toBeNull()
    expect(parseAppleAppId("short.co.bmc.freeblackmarket")).toBeNull()
  })
})

describe("buildAppleAppSiteAssociation", () => {
  it("keeps the API and handoff surfaces out of universal links", () => {
    const payload = buildAppleAppSiteAssociation(
      "AB12CD34EF.co.bmc.freeblackmarket"
    ) as {
      applinks: { details: Array<{ appID: string; paths: string[] }> }
    }
    expect(payload.applinks.details[0].appID).toBe(
      "AB12CD34EF.co.bmc.freeblackmarket"
    )
    expect(payload.applinks.details[0].paths).toEqual(["NOT /api/*", "*"])
  })
})
