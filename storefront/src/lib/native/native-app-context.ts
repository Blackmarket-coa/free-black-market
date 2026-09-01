/**
 * Detection helpers for the FBM Capacitor shell (`mobile/`).
 *
 * The shell loads the deployed storefront via `server.url`, so the web
 * bundle never imports Capacitor npm packages — the native runtime injects
 * `window.Capacitor` into the page, and everything here feature-detects
 * that bridge (same posture as the Blackout client's platform layer).
 * Server-side code can't see the bridge, so the shell also appends the
 * `FBMNative/1.0` marker to the WebView user agent (capacitor.config.ts)
 * for SSR/middleware decisions.
 *
 * Pure helpers only; safe to import from client components, server
 * components, and route handlers alike.
 */

/** UA fragment the shell appends via Capacitor's `appendUserAgent`. */
export const NATIVE_APP_UA_MARKER = "FBMNative"

export type NativePlatform = "ios" | "android"

export type CapacitorBrowserPlugin = {
  open?: (options: {
    url: string
    presentationStyle?: "fullscreen" | "popover"
  }) => Promise<unknown>
}

export type CapacitorDevicePlugin = {
  getLanguageTag?: () => Promise<{ value?: string }>
}

export type CapacitorAppListenerHandle = {
  remove: () => Promise<void> | void
}

export type CapacitorAppPlugin = {
  addListener?: (
    event: string,
    handler: (payload: never) => void
  ) => Promise<CapacitorAppListenerHandle> | CapacitorAppListenerHandle
}

export type CapacitorPushNotificationsPlugin = {
  requestPermissions?: () => Promise<{ receive?: string }>
  register?: () => Promise<void>
  addListener?: (
    event: string,
    handler: (payload: never) => void
  ) => Promise<CapacitorAppListenerHandle> | CapacitorAppListenerHandle
}

export type CapacitorBridge = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: {
    App?: CapacitorAppPlugin
    Browser?: CapacitorBrowserPlugin
    Device?: CapacitorDevicePlugin
    PushNotifications?: CapacitorPushNotificationsPlugin
  }
}

/** The injected bridge, or undefined outside the shell / during SSR. */
export function getCapacitorBridge(): CapacitorBridge | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor
}

/** True only when running inside the native shell's WebView. */
export function isNativeApp(): boolean {
  const bridge = getCapacitorBridge()
  return (
    typeof bridge?.isNativePlatform === "function" &&
    bridge.isNativePlatform() === true
  )
}

/** `'ios' | 'android'` inside the shell, `null` on the plain web / SSR. */
export function getNativePlatform(): NativePlatform | null {
  if (!isNativeApp()) return null
  const platform = getCapacitorBridge()?.getPlatform?.()
  return platform === "ios" || platform === "android" ? platform : null
}

/**
 * Server-usable check: does this user agent belong to the native shell?
 * (Client code should prefer `isNativeApp()` — the bridge can't be
 * spoofed by a plain browser, while a UA string can.)
 */
export function isNativeAppUserAgent(
  userAgent: string | null | undefined
): boolean {
  return Boolean(userAgent && userAgent.includes(NATIVE_APP_UA_MARKER))
}
