"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react"
import { getMatrixChatConfig, MatrixChatConfig } from "@/lib/data/matrix"
import {
  elementBaseUrl,
  elementRoomUrl,
  elementHomeUrl,
  vendorRoomAlias,
  orderRoomAlias,
} from "@/lib/util/element-url"

interface MatrixChatContextType {
  isConfigured: boolean
  isLoading: boolean
  elementUrl: string | null
  homeserverUrl: string | null
  serverName: string | null
  mxid: string | null
  loginToken: string | null
  defaultRoomAlias: string | null
  unreadCount: number
  connectionState: "idle" | "connecting" | "connected" | "error"
  // Helper functions for building Element room URLs
  getRoomUrl: (localAlias: string) => string | null
  getVendorRoomUrl: (vendorHandle: string) => string | null
  getOrderRoomUrl: (orderId: string) => string | null
  /** Back-compat helper used by scheduling UI. */
  getVendorChannelUrl: (vendorHandle: string) => string | null
  getHomeUrl: () => string | null
  // Refresh config (e.g., after login)
  refreshConfig: () => Promise<void>
}

const noop = () => null

const MatrixChatContext = createContext<MatrixChatContextType>({
  isConfigured: false,
  isLoading: true,
  elementUrl: null,
  homeserverUrl: null,
  serverName: null,
  mxid: null,
  loginToken: null,
  defaultRoomAlias: null,
  unreadCount: 0,
  connectionState: "idle",
  getRoomUrl: noop,
  getVendorRoomUrl: noop,
  getOrderRoomUrl: noop,
  getVendorChannelUrl: noop,
  getHomeUrl: noop,
  refreshConfig: async () => {},
})

export const useMatrixChat = () => {
  const context = useContext(MatrixChatContext)
  if (!context) {
    throw new Error("useMatrixChat must be used within a MatrixChatProvider")
  }
  return context
}

interface MatrixChatProviderProps {
  children: ReactNode
  // Optional: pre-fetched config from a server component
  initialConfig?: MatrixChatConfig | null
}

export const MatrixChatProvider = ({
  children,
  initialConfig,
}: MatrixChatProviderProps) => {
  const [isLoading, setIsLoading] = useState(!initialConfig)
  const [isConfigured, setIsConfigured] = useState(initialConfig?.configured ?? false)
  const [elementUrl, setElementUrl] = useState<string | null>(
    initialConfig?.element_url ?? null
  )
  const [homeserverUrl, setHomeserverUrl] = useState<string | null>(
    initialConfig?.homeserver_url ?? null
  )
  const [serverName, setServerName] = useState<string | null>(
    initialConfig?.server_name ?? null
  )
  const [mxid, setMxid] = useState<string | null>(initialConfig?.mxid ?? null)
  const [loginToken, setLoginToken] = useState<string | null>(
    initialConfig?.login?.login_token ?? null
  )
  const [defaultRoomAlias, setDefaultRoomAlias] = useState<string | null>(
    initialConfig?.default_room_alias ?? null
  )
  const [unreadCount] = useState(0)
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "connected" | "error"
  >(initialConfig ? "connecting" : "idle")

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true)
      const config = await getMatrixChatConfig()

      if (config && config.configured) {
        setConnectionState("connecting")
        setIsConfigured(true)
        setElementUrl(config.element_url ?? elementBaseUrl())
        setHomeserverUrl(config.homeserver_url ?? null)
        setServerName(config.server_name ?? null)
        setMxid(config.mxid ?? null)
        setDefaultRoomAlias(config.default_room_alias ?? null)
        setLoginToken(config.login?.login_token ?? null)
      } else {
        // Fallback to public env var if the server fetch is unavailable.
        const fallbackUrl = elementBaseUrl()
        setIsConfigured(Boolean(fallbackUrl))
        setElementUrl(fallbackUrl)
        setConnectionState(fallbackUrl ? "connecting" : "idle")
      }
    } catch (error) {
      console.error("[MatrixChatProvider] Failed to fetch config:", error)
      const fallbackUrl = elementBaseUrl()
      setIsConfigured(Boolean(fallbackUrl))
      setElementUrl(fallbackUrl)
      setConnectionState(fallbackUrl ? "connecting" : "error")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!initialConfig) {
      fetchConfig()
    }
  }, [initialConfig, fetchConfig])

  const getRoomUrl = useCallback(
    (localAlias: string) =>
      elementRoomUrl({
        alias: localAlias,
        base: elementUrl,
        serverName: serverName ?? undefined,
        loginToken,
      }),
    [elementUrl, serverName, loginToken]
  )

  const getVendorRoomUrl = useCallback(
    (vendorHandle: string) => getRoomUrl(vendorRoomAlias(vendorHandle)),
    [getRoomUrl]
  )

  const getOrderRoomUrl = useCallback(
    (orderId: string) => getRoomUrl(orderRoomAlias(orderId)),
    [getRoomUrl]
  )

  const getHomeUrl = useCallback(
    () => elementHomeUrl(elementUrl, loginToken),
    [elementUrl, loginToken]
  )

  return (
    <MatrixChatContext.Provider
      value={{
        isConfigured,
        isLoading,
        elementUrl,
        homeserverUrl,
        serverName,
        mxid,
        loginToken,
        defaultRoomAlias,
        unreadCount,
        connectionState,
        getRoomUrl,
        getVendorRoomUrl,
        getOrderRoomUrl,
        getVendorChannelUrl: getVendorRoomUrl,
        getHomeUrl,
        refreshConfig: fetchConfig,
      }}
    >
      {children}
    </MatrixChatContext.Provider>
  )
}
