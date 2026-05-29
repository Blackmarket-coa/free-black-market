import { Container, Heading, Text, Badge } from "@medusajs/ui"
import { useMatrixChat } from "../../providers/matrix-provider"
import { useMemo } from "react"

export const Messages = () => {
  const {
    isConfigured,
    elementUrl,
    unreadCount,
    seller,
    defaultRoomAlias,
    getRoomUrl,
    getHomeUrl,
  } = useMatrixChat()

  // Open the vendor's room by default; Element's own room list handles further
  // navigation (we only inject the single-use login token on the initial load).
  const iframeUrl = useMemo(() => {
    let localAlias: string | null = null
    if (defaultRoomAlias) {
      localAlias = defaultRoomAlias.replace(/^#/, "").split(":")[0]
    } else if (seller?.handle) {
      localAlias = `vendor-${seller.handle}`
    } else if (seller?.id) {
      localAlias = `vendor-${seller.id}`
    }
    return localAlias ? getRoomUrl(localAlias) : getHomeUrl()
  }, [defaultRoomAlias, seller, getRoomUrl, getHomeUrl])

  return (
    <Container className="divide-y p-0 min-h-[700px]">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Heading>Messages</Heading>
          {unreadCount > 0 && (
            <Badge color="red" size="small">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        {isConfigured && elementUrl && (
          <a
            href={elementUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ui-fg-interactive text-sm hover:underline"
          >
            Open in new tab
          </a>
        )}
      </div>

      <div className="px-6 py-4 h-[655px]">
        {isConfigured && iframeUrl ? (
          <iframe
            src={iframeUrl}
            className="w-full h-full border-0 rounded-lg"
            title="Matrix Messages"
            allow="camera; microphone; fullscreen; display-capture; autoplay"
          />
        ) : (
          <div className="flex flex-col items-center w-full h-full justify-center">
            <Heading>No Chat Configured</Heading>
            <Text className="text-ui-fg-subtle mt-4" size="small">
              Blackout Chat is not configured. Contact your administrator.
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}
