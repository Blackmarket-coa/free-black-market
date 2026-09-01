import { afterEach, describe, expect, it } from "vitest"
import {
  NATIVE_APP_UA_MARKER,
  getNativePlatform,
  isNativeApp,
  isNativeAppUserAgent,
} from "@/lib/native/native-app-context"

type TestWindow = { Capacitor?: unknown }

const setWindow = (win: TestWindow | undefined) => {
  if (win === undefined) {
    delete (globalThis as { window?: TestWindow }).window
  } else {
    ;(globalThis as { window?: TestWindow }).window = win
  }
}

afterEach(() => {
  setWindow(undefined)
})

describe("isNativeAppUserAgent", () => {
  it("recognises the shell marker anywhere in the UA", () => {
    expect(
      isNativeAppUserAgent(
        `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ${NATIVE_APP_UA_MARKER}/1.0`
      )
    ).toBe(true)
  })

  it("rejects ordinary browsers and empty values", () => {
    expect(isNativeAppUserAgent("Mozilla/5.0 (Macintosh)")).toBe(false)
    expect(isNativeAppUserAgent("")).toBe(false)
    expect(isNativeAppUserAgent(null)).toBe(false)
    expect(isNativeAppUserAgent(undefined)).toBe(false)
  })
})

describe("isNativeApp / getNativePlatform", () => {
  it("is false without a window (SSR)", () => {
    expect(isNativeApp()).toBe(false)
    expect(getNativePlatform()).toBeNull()
  })

  it("is false in a plain browser window", () => {
    setWindow({})
    expect(isNativeApp()).toBe(false)
    expect(getNativePlatform()).toBeNull()
  })

  it("reports the platform inside the shell", () => {
    setWindow({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
    })
    expect(isNativeApp()).toBe(true)
    expect(getNativePlatform()).toBe("ios")
  })

  it("returns null for unexpected platform values", () => {
    setWindow({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "web" },
    })
    expect(getNativePlatform()).toBeNull()
  })
})
