/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FBM_API_URL?: string
  readonly VITE_BLACKOUT_URL?: string
  readonly VITE_PRACTITIONER_ID?: string
  readonly VITE_PRACTITIONER_NAME?: string
  readonly VITE_CONNECT_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
