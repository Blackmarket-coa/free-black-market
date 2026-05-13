export type StorefrontContext = {
  organizationId: string
  storefrontId: string
}

const KEY = "fbm_storefront_context"

export const getStoredContext = (): StorefrontContext | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    
return raw ? (JSON.parse(raw) as StorefrontContext) : null
  } catch {
    return null
  }
}

export const setStoredContext = (ctx: StorefrontContext) => {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(ctx))
}

export const withStorefrontHeaders = (
  ctx: StorefrontContext | null
): Record<string, string> =>
  ctx
    ? {
        "x-organization-id": ctx.organizationId,
        "x-storefront-id": ctx.storefrontId,
      }
    : {}
