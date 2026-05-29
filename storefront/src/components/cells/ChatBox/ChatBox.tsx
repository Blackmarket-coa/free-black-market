"use client"

import { elementRoomUrl } from "@/lib/util/element-url"

type ChatProps = {
  order_id?: string
  product_id?: string
  subject?: string | null
  currentUser: {
    id: string
    name: string
    email: string | null
    photoUrl?: string
    role: string
  }
  supportUser: {
    id: string
    name: string
    email: string | null
    photoUrl?: string
    role: string
  }
}

export function ChatBox({
  currentUser,
  supportUser,
  subject,
  order_id,
  product_id,
}: ChatProps) {
  // Build a room alias for the conversation
  const roomAlias = `product-${product_id || order_id}-${currentUser.id}-${supportUser.id}`
  const iframeUrl = elementRoomUrl({ alias: roomAlias })

  if (!iframeUrl) {
    return (
      <div className="w-full h-[500px] flex items-center justify-center text-gray-500">
        Chat is not configured. Please set NEXT_PUBLIC_MATRIX_ELEMENT_URL.
      </div>
    )
  }

  return (
    <div className="w-full h-[500px]">
      <iframe
        src={iframeUrl}
        title={`Chat with ${supportUser.name || 'Support'}`}
        className="w-full h-full border-0 rounded-lg"
        allow="camera; microphone; fullscreen; display-capture"
      />
    </div>
  )
}
