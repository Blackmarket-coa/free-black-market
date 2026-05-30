"use server"

import { medusaFetch } from "../config"
import { getAuthHeaders } from "./cookies"

export interface MatrixChatConfig {
  configured: boolean
  element_url?: string
  homeserver_url?: string
  server_name?: string
  mxid?: string | null
  default_room_alias?: string
  login?: {
    login_token: string
    expires_in_ms: number
  }
  message?: string
}

/**
 * Fetch Matrix/Element chat configuration for the authenticated customer.
 * Returns config including a single-use login token for Element auto-login.
 */
export async function getMatrixChatConfig(): Promise<MatrixChatConfig | null> {
  try {
    const authHeaders = await getAuthHeaders()
    if (!authHeaders) {
      return null
    }

    const config = await medusaFetch<MatrixChatConfig>("/store/chat", {
      method: "GET",
      headers: authHeaders,
      cache: "no-store", // Never cache auth-related data
    })

    return config
  } catch (error) {
    console.error("[getMatrixChatConfig] Error:", error)
    return null
  }
}
