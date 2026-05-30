"use client"

import { useState, useMemo } from "react"
import { useMatrixChat } from "@/providers/MatrixChatProvider"
import {
  elementRoomUrl,
  elementHomeUrl,
  vendorRoomAlias,
  orderRoomAlias,
} from "@/lib/util/element-url"

interface UserMessagesSectionProps {
  // Optional: specific room alias (local part, e.g. "vendor-acme") to open.
  channelName?: string
}

export const UserMessagesSection = ({
  channelName,
}: UserMessagesSectionProps = {}) => {
  const {
    isConfigured,
    isLoading,
    elementUrl,
    serverName,
    loginToken,
    defaultRoomAlias,
  } = useMatrixChat()

  const [isFullscreen, setIsFullscreen] = useState(false)

  // Build the Element URL: deep-link to a room if requested, otherwise the
  // default room / home view. The single-use login token auto-logs the user in.
  const iframeUrl = useMemo(() => {
    if (!elementUrl) return null

    if (channelName) {
      return elementRoomUrl({
        alias: channelName,
        base: elementUrl,
        serverName: serverName ?? undefined,
        loginToken,
      })
    }

    // Default room alias from backend is a full "#alias:server"; strip to local.
    if (defaultRoomAlias) {
      const localAlias = defaultRoomAlias.replace(/^#/, "").split(":")[0]
      return elementRoomUrl({
        alias: localAlias,
        base: elementUrl,
        serverName: serverName ?? undefined,
        loginToken,
      })
    }

    return elementHomeUrl(elementUrl, loginToken)
  }, [elementUrl, serverName, loginToken, channelName, defaultRoomAlias])

  if (isLoading) {
    return (
      <div className="max-w-full h-[655px] flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-sm mt-4">Loading chat...</p>
        </div>
      </div>
    )
  }

  if (!isConfigured || !elementUrl || !iframeUrl) {
    return (
      <div className="max-w-full h-[655px] flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg font-medium">Chat is not configured</p>
          <p className="text-sm mt-2">Please contact support for assistance.</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`max-w-full ${
        isFullscreen ? "fixed inset-0 z-50 bg-white" : "h-[655px]"
      }`}
    >
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xl font-semibold">Messages</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="text-sm text-primary hover:underline"
          >
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
          <a
            href={elementUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            Open in new tab
          </a>
        </div>
      </div>
      <iframe
        src={iframeUrl}
        title="Messages"
        className={`w-full border-0 rounded-lg ${
          isFullscreen ? "h-[calc(100vh-60px)]" : "h-[600px]"
        }`}
        allow="camera; microphone; fullscreen; display-capture; autoplay"
      />
    </div>
  )
}

// Helper to get a vendor room URL (for use outside the component / SSR).
export const getVendorChannelUrl = (vendorHandle: string) =>
  elementRoomUrl({ alias: vendorRoomAlias(vendorHandle) })

// Helper to get an order room URL (for use outside the component / SSR).
export const getOrderChannelUrl = (orderId: string) =>
  elementRoomUrl({ alias: orderRoomAlias(orderId) })
