import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react"
import { useMe } from "../../hooks/api"
import { sdk } from "../../lib/client"
import { devLogger } from "../../lib/logger"
import {
  elementBaseUrlFromEnv,
  elementRoomUrl,
  elementHomeUrl,
} from "../../lib/element-url"

interface MatrixChatConfig {
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
}

interface MatrixContextType {
  isConfigured: boolean
  elementUrl: string | null
  serverName: string | null
  mxid: string | null
  isLoading: boolean
  unreadCount: number
  seller: any
  loginToken: string | null
  defaultRoomAlias: string | null
  // Helper functions for building Element room URLs
  getRoomUrl: (localAlias: string) => string | null
  getOrderRoomUrl: (orderId: string) => string | null
  getHomeUrl: () => string | null
}

const MatrixContext = createContext<MatrixContextType>({
  isConfigured: false,
  elementUrl: null,
  serverName: null,
  mxid: null,
  isLoading: true,
  unreadCount: 0,
  seller: null,
  loginToken: null,
  defaultRoomAlias: null,
  getRoomUrl: () => null,
  getOrderRoomUrl: () => null,
  getHomeUrl: () => null,
})

export const useMatrixChat = () => useContext(MatrixContext)

export const MatrixProvider = ({ children }: { children: ReactNode }) => {
  const { seller, isPending } = useMe()
  const [isConfigured, setIsConfigured] = useState(false)
  const [elementUrl, setElementUrl] = useState<string | null>(null)
  const [serverName, setServerName] = useState<string | null>(null)
  const [mxid, setMxid] = useState<string | null>(null)
  const [loginToken, setLoginToken] = useState<string | null>(null)
  const [defaultRoomAlias, setDefaultRoomAlias] = useState<string | null>(null)
  const [unreadCount] = useState(0)

  useEffect(() => {
    const fetchMatrixConfig = async () => {
      try {
        const response = await sdk.client.fetch<MatrixChatConfig>("/vendor/chat", {
          method: "GET",
        })

        if (response.configured) {
          setIsConfigured(true)
          setElementUrl(response.element_url ?? elementBaseUrlFromEnv())
          setServerName(response.server_name ?? null)
          setMxid(response.mxid ?? null)
          setDefaultRoomAlias(response.default_room_alias ?? null)
          if (response.login) {
            setLoginToken(response.login.login_token)
          }
        }
      } catch (error) {
        devLogger.error("Failed to fetch Matrix chat config:", error)
        setIsConfigured(false)
      }
    }

    if (!isPending && seller) {
      fetchMatrixConfig()
    }
  }, [seller, isPending])

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

  const getOrderRoomUrl = useCallback(
    (orderId: string) => getRoomUrl(`order-${orderId.replace("order_", "")}`),
    [getRoomUrl]
  )

  const getHomeUrl = useCallback(
    () => elementHomeUrl(elementUrl, loginToken),
    [elementUrl, loginToken]
  )

  if (isPending) {
    return <div className="flex justify-center items-center h-screen" />
  }

  return (
    <MatrixContext.Provider
      value={{
        isConfigured,
        elementUrl,
        serverName,
        mxid,
        isLoading: isPending,
        unreadCount,
        seller,
        loginToken,
        defaultRoomAlias,
        getRoomUrl,
        getOrderRoomUrl,
        getHomeUrl,
      }}
    >
      {children}
    </MatrixContext.Provider>
  )
}
