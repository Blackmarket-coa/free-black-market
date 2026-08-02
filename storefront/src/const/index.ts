export const PRODUCT_LIMIT = 12

export const PARENT_CATEGORIES = ["menswear", "womenswear"]

/**
 * Public URL of the vendor panel (seller dashboard). Vendors authenticate
 * against a different actor type than shoppers, so their login lives on this
 * separate origin.
 */
export const VENDOR_PANEL_URL =
  process.env.NEXT_PUBLIC_VENDOR_PANEL_URL ||
  process.env.NEXT_PUBLIC_VENDOR_URL ||
  "https://vendor.freeblackmarket.com"
