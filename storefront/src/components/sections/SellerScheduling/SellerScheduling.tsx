"use client"

import { useMemo } from "react"
import { Button } from "@/components/atoms"
import { useRocketChat } from "@/providers/RocketChatProvider"
import type { SellerProps, SellerScheduling as SellerSchedulingMeta } from "@/types/seller"

const PLATFORM_LABELS: Record<string, string> = {
  rocketchat: "Rocket.Chat",
  zoom: "Zoom",
  signal: "Signal",
  custom: "video call",
}

const hasSchedulingDetails = (scheduling?: SellerSchedulingMeta) => {
  if (!scheduling) return false
  return Boolean(
    scheduling.booking_url ||
      scheduling.meeting_url ||
      scheduling.meeting_platform ||
      scheduling.meeting_instructions ||
      scheduling.ticket_product_handle
  )
}

const openExternalLink = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer")
}

export const SellerScheduling = ({ seller }: { seller: SellerProps }) => {
  const { getVendorChannelUrl, isConfigured } = useRocketChat()
  const scheduling = seller.metadata?.scheduling

  const vendorChannelUrl = useMemo(() => {
    if (!seller.handle) return null
    return getVendorChannelUrl(seller.handle)
  }, [getVendorChannelUrl, seller.handle])

  const meetingPlatform = scheduling?.meeting_platform
    ? scheduling.meeting_platform.toLowerCase().replace(/[^a-z]/g, "")
    : null
  const platformLabel = meetingPlatform
    ? PLATFORM_LABELS[meetingPlatform] || scheduling?.meeting_platform
    : scheduling?.meeting_platform

  if (!hasSchedulingDetails(scheduling)) {
    return null
  }

  return (
    <div className="border rounded-sm p-4 mt-6">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-lg font-semibold">Schedule a session</p>
          <p className="text-secondary text-sm">
            Book a digital service like coaching, consulting, or readings.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {scheduling?.booking_url && (
            <Button
              type="button"
              variant="filled"
              size="large"
              onClick={() => openExternalLink(scheduling.booking_url!)}
            >
              Book a session
            </Button>
          )}
          {scheduling?.ticket_product_handle && (
            <Button
              type="button"
              variant="tonal"
              size="large"
              onClick={() =>
                openExternalLink(`/products/${scheduling.ticket_product_handle}`)
              }
            >
              Book a ticket
            </Button>
          )}
          {meetingPlatform === "rocketchat" && isConfigured && vendorChannelUrl && (
            <Button
              type="button"
              variant="tonal"
              size="large"
              onClick={() => openExternalLink(vendorChannelUrl)}
            >
              Start a Rocket.Chat session
            </Button>
          )}
          {scheduling?.meeting_url && (
            <Button
              type="button"
              variant="text"
              size="large"
              onClick={() => openExternalLink(scheduling.meeting_url!)}
            >
              Join {platformLabel || "session"}
            </Button>
          )}
        </div>
        {scheduling?.meeting_instructions && (
          <p className="text-sm text-secondary">
            {scheduling.meeting_instructions}
          </p>
        )}
        {meetingPlatform === "rocketchat" && !isConfigured && (
          <p className="text-sm text-secondary">
            Rocket.Chat is not configured yet. Please use the booking link or
            contact the seller for details.
          </p>
        )}
      </div>
    </div>
  )
}
