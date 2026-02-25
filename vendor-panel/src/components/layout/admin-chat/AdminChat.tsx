import { ChatBubble } from "@medusajs/icons"
import { Drawer, Heading, IconButton, Text } from "@medusajs/ui"
import { useState, useRef, useEffect, useCallback } from "react"
import { useMe } from "../../../hooks/api"
import { useRocketChat } from "../../../providers/rocketchat-provider"
import { devLogger } from "../../../lib/logger"

export const AdminChat = () => {
  const [open, setOpen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const loginAttemptedRef = useRef(false)

  const { seller, isPending } = useMe()
  const { isConfigured, rocketChatUrl, loginToken } = useRocketChat()

  // Auto-login to RocketChat via postMessage when iframe loads
  const handleIframeLogin = useCallback(() => {
    if (!iframeRef.current || !loginToken || !rocketChatUrl || loginAttemptedRef.current) return

    try {
      const iframe = iframeRef.current
      const targetOrigin = new URL(rocketChatUrl).origin

      // Send login-with-token message to RocketChat iframe
      iframe.contentWindow?.postMessage({
        externalCommand: 'login-with-token',
        token: loginToken
      }, targetOrigin)

      loginAttemptedRef.current = true
      devLogger.log("[RocketChat] Admin chat: Sent auto-login token to iframe")
    } catch (error) {
      devLogger.error(
        "[RocketChat] Admin chat: Failed to send login token:",
        error
      )
    }
  }, [loginToken, rocketChatUrl])

  // Listen for messages from RocketChat iframe
  useEffect(() => {
    if (!rocketChatUrl || !open) return

    const targetOrigin = new URL(rocketChatUrl).origin

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return

      // Handle RocketChat ready event
      if (event.data?.eventName === 'startup') {
        devLogger.log(
          "[RocketChat] Admin chat: Iframe ready, attempting auto-login"
        )
        handleIframeLogin()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [rocketChatUrl, handleIframeLogin, open])

  // Reset login state when drawer closes or token changes
  useEffect(() => {
    if (!open) {
      loginAttemptedRef.current = false
    }
  }, [open, loginToken])

  // Handle iframe load event as fallback
  const handleIframeLoad = useCallback(() => {
    // Small delay to ensure RocketChat is fully loaded
    setTimeout(() => {
      if (!loginAttemptedRef.current) {
        handleIframeLogin()
      }
    }, 1000)
  }, [handleIframeLogin])

  if (isPending)
    return <div className="flex justify-center items-center h-screen" />

  const handleOnOpen = (shouldOpen: boolean) => {
    if (shouldOpen) {
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  // Build iframe URL with channel parameter for admin chat
  const adminChatUrl = rocketChatUrl
    ? `${rocketChatUrl}/channel/admin-vendor-${seller?.id}`
    : ""

  return (
    <Drawer open={open} onOpenChange={handleOnOpen}>
      <Drawer.Trigger asChild>
        <IconButton
          variant="transparent"
          className="text-ui-fg-muted hover:text-ui-fg-subtle"
        >
          <ChatBubble />
        </IconButton>
      </Drawer.Trigger>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title asChild>
            <Heading>Chat with admin</Heading>
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="overflow-y-auto px-4">
          {isConfigured ? (
            <iframe
              ref={iframeRef}
              src={adminChatUrl}
              title="Admin Chat"
              style={{ width: "100%", height: "100%", border: "none" }}
              allow="camera; microphone; fullscreen; display-capture"
              onLoad={handleIframeLoad}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <ChatBubble className="w-12 h-12 text-ui-fg-muted mb-4" />
              <Text className="text-ui-fg-muted">
                Chat is not configured. Please set VITE_ROCKETCHAT_URL in your environment.
              </Text>
            </div>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer>
  )
}
