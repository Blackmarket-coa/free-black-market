import { afterEach, describe, expect, it, vi } from "vitest"
import {
  openExternalUrl,
  regionFromLanguageTag,
  resolveDeviceRegion,
  resolveExternalPurchasePolicy,
} from "@/lib/native/external-purchase"

type TestWindow = {
  Capacitor?: unknown
  open?: (...args: unknown[]) => unknown
  location?: { origin: string }
}

const setWindow = (win: TestWindow | undefined) => {
  if (win === undefined) {
    delete (globalThis as { window?: TestWindow }).window
  } else {
    ;(globalThis as { window?: TestWindow }).window = win
  }
}

afterEach(() => {
  setWindow(undefined)
  vi.restoreAllMocks()
})

describe("regionFromLanguageTag", () => {
  it("extracts regions from BCP-47 tags", () => {
    expect(regionFromLanguageTag("en-US")).toBe("US")
    expect(regionFromLanguageTag("pt-BR")).toBe("BR")
    expect(regionFromLanguageTag("en_US")).toBe("US")
    expect(regionFromLanguageTag("zh-Hans-CN")).toBe("CN")
  })

  it("returns null when no region is present", () => {
    expect(regionFromLanguageTag("en")).toBeNull()
    expect(regionFromLanguageTag("")).toBeNull()
    expect(regionFromLanguageTag(null)).toBeNull()
    expect(regionFromLanguageTag("!!nope!!")).toBeNull()
  })
})

describe("resolveExternalPurchasePolicy", () => {
  it("hides the button outside the shell", () => {
    expect(
      resolveExternalPurchasePolicy({ platform: null, region: "US" })
    ).toEqual({ allowed: false, reason: "not-native" })
  })

  it("always allows Android", () => {
    for (const region of ["US", "DE", null]) {
      expect(
        resolveExternalPurchasePolicy({ platform: "android", region })
      ).toEqual({ allowed: true, reason: "android-external-checkout" })
    }
  })

  it("allows iOS only on the US storefront", () => {
    expect(
      resolveExternalPurchasePolicy({ platform: "ios", region: "US" })
    ).toEqual({ allowed: true, reason: "ios-us-storefront-link-out" })
  })

  it("fails closed on iOS for non-US and unknown regions", () => {
    for (const region of ["PL", "GB", null]) {
      expect(
        resolveExternalPurchasePolicy({ platform: "ios", region })
      ).toEqual({ allowed: false, reason: "ios-storefront-not-us" })
    }
  })
})

describe("resolveDeviceRegion", () => {
  it("prefers the Device plugin language tag", async () => {
    setWindow({
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          Device: { getLanguageTag: async () => ({ value: "fr-CA" }) },
        },
      },
    })
    await expect(resolveDeviceRegion()).resolves.toBe("CA")
  })
})

describe("openExternalUrl", () => {
  it("rejects malformed and non-https URLs", async () => {
    await expect(openExternalUrl("not a url")).resolves.toBe("failed")
    await expect(openExternalUrl("javascript:alert(1)")).resolves.toBe("failed")
    await expect(openExternalUrl("http://evil.example/x")).resolves.toBe(
      "failed"
    )
  })

  it("uses the Browser plugin inside the shell", async () => {
    const open = vi.fn(async () => undefined)
    setWindow({
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
        Plugins: { Browser: { open } },
      },
    })
    await expect(
      openExternalUrl("https://freeblackmarket.com/us/checkout")
    ).resolves.toBe("capacitor-browser")
    expect(open).toHaveBeenCalledWith({
      url: "https://freeblackmarket.com/us/checkout",
      presentationStyle: "fullscreen",
    })
  })

  it("falls back to window.open outside the shell", async () => {
    const open = vi.fn(() => ({}))
    setWindow({ open })
    await expect(openExternalUrl("https://freeblackmarket.com/us")).resolves.toBe(
      "window-open"
    )
    expect(open).toHaveBeenCalledWith(
      "https://freeblackmarket.com/us",
      "_blank",
      "noopener,noreferrer"
    )
  })
})
