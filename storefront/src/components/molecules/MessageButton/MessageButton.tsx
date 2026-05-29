"use client"

import { Badge } from "@/components/atoms"
import { MessageIcon } from "@/icons"
import LocalizedClientLink from "../LocalizedLink/LocalizedLink"
import { useMatrixChat } from "@/providers/MatrixChatProvider"

export const MessageButton = () => {
  const { unreadCount } = useMatrixChat()

  return (
    <LocalizedClientLink href="/user/messages" className="relative">
      <MessageIcon size={20} />
      {unreadCount > 0 && (
        <Badge className="absolute -top-2 -right-2 w-4 h-4 p-0">
          {unreadCount}
        </Badge>
      )}
    </LocalizedClientLink>
  )
}
