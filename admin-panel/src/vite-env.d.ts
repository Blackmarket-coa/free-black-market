// / <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEDUSA_ADMIN_BACKEND_URL: string
  readonly VITE_MEDUSA_STOREFRONT_URL: string
  readonly VITE_MEDUSA_V2: "true" | "false"
  readonly VITE_FF_POS_V1?: "true" | "false"
  readonly VITE_FF_WEIGHT_PRICING_V1?: "true" | "false"
  readonly VITE_FF_PICK_PACK_V1?: "true" | "false"
  readonly VITE_FF_INVOICING_V1?: "true" | "false"
  readonly VITE_FF_CHANNEL_SYNC_V1?: "true" | "false"
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  readonly hot: {
    accept: () => void
  }
}

declare const __BACKEND_URL__: string | undefined
declare const __STOREFRONT_URL__: string | undefined
declare const __BASE__: string
