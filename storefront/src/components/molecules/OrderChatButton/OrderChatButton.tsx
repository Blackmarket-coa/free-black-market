"use client"

import { MessageCircle } from "lucide-react"
import {
  elementRoomUrl,
  vendorRoomAlias,
  orderRoomAlias,
} from "@/lib/util/element-url"

interface OrderChatButtonProps {
  orderId: string
  sellerHandle?: string
  className?: string
}

export const OrderChatButton = ({
  orderId,
  sellerHandle,
  className = "",
}: OrderChatButtonProps) => {
  // Order chat goes to the vendor room when known, else an order-specific room.
  const channelUrl = elementRoomUrl({
    alias: sellerHandle
      ? vendorRoomAlias(sellerHandle)
      : orderRoomAlias(orderId),
  })

  if (!channelUrl) {
    return null
  }

  const handleClick = () => {
    window.open(channelUrl, "_blank", "noopener,noreferrer")
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors ${className}`}
    >
      <MessageCircle className="w-4 h-4" />
      <span>Chat about this order</span>
    </button>
  )
}
