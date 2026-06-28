/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FBM_API_URL?: string
  readonly VITE_BLACKOUT_URL?: string
  readonly VITE_OPERATOR_TYPE?: "maker" | "collective"
  readonly VITE_NURSERY_NODE_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
