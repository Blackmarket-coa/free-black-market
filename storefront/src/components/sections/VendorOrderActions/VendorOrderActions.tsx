"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "@medusajs/ui"
import { Button } from "@/components/atoms"
import {
  markVendorOrderDelivered,
  markVendorOrderShipped,
} from "@/lib/data/vendor-orders"
import { VENDOR_PANEL_URL } from "@/const"
import type { VendorOrderStage } from "@/lib/helpers/vendor-orders"

/**
 * The two fulfillment actions that are genuinely phone-shaped.
 *
 * Packing is deliberately absent: creating a fulfillment needs a stock
 * location and per-line quantities backed by live inventory reservations,
 * and fails opaquely without them. Cancels and returns are absent because
 * they move money. Those stay in the full dashboard, which this component
 * links to rather than reimplementing.
 */
export const VendorOrderActions = ({
  orderId,
  stage,
}: {
  orderId: string
  stage: VendorOrderStage
}) => {
  const router = useRouter()
  const [tracking, setTracking] = useState("")
  const [pending, startTransition] = useTransition()

  const ship = () => {
    startTransition(async () => {
      const result = await markVendorOrderShipped({
        orderId,
        trackingNumber: tracking,
      })
      if (result.ok) {
        toast.success("Marked shipped")
        setTracking("")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  const deliver = () => {
    startTransition(async () => {
      const result = await markVendorOrderDelivered({ orderId })
      if (result.ok) {
        toast.success("Marked delivered")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  if (stage === "closed") {
    return null
  }

  if (stage === "awaiting_fulfillment") {
    return (
      <div className="border rounded-sm p-4">
        <p className="label-md text-secondary mb-3">
          This order still needs packing. Packing needs your stock location and
          item quantities, so it happens in the full dashboard.
        </p>
        <a
          href={`${VENDOR_PANEL_URL}/orders/${orderId}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          <Button
            variant="tonal"
            className="w-full py-3 flex justify-center items-center"
          >
            Open in vendor dashboard
          </Button>
        </a>
      </div>
    )
  }

  if (stage === "ready_to_ship") {
    return (
      <div className="border rounded-sm p-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="label-md">Tracking number</span>
          <input
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="e.g. 9400111899223"
            className="border rounded-sm p-3 bg-primary"
            data-testid="vendor-tracking-input"
          />
        </label>
        <Button
          onClick={ship}
          loading={pending}
          disabled={pending || tracking.trim().length === 0}
          className="w-full py-3 flex justify-center items-center"
          data-testid="vendor-mark-shipped"
        >
          Mark shipped
        </Button>
      </div>
    )
  }

  return (
    <div className="border rounded-sm p-4">
      <p className="label-md text-secondary mb-3">
        On its way. Confirm once the buyer has it.
      </p>
      <Button
        onClick={deliver}
        loading={pending}
        disabled={pending}
        className="w-full py-3 flex justify-center items-center"
        data-testid="vendor-mark-delivered"
      >
        Mark delivered
      </Button>
    </div>
  )
}
