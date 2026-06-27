/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FBM_API_URL?: string
  readonly VITE_BLACKOUT_URL?: string
  readonly VITE_NODE_ID?: string
  readonly VITE_PORTAL_ROLE?: "hub" | "node"
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
