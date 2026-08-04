import { useState } from "react"
import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"

import {
  describeChannelOrder,
  useRecordChannelShipment,
  useVendorChannelOrders,
  type ChannelOrder,
} from "../../../../../hooks/api/vendor-channel-orders"

/**
 * Orders that arrived from a connected sales channel.
 *
 * Rendered on the existing orders page rather than as a separate section of
 * the app: a vendor should not have to remember which screen a sale is on
 * depending on where it happened. They cannot be folded into the Medusa order
 * table itself — a channel order was paid for elsewhere and has no Medusa
 * order behind it, and manufacturing one would invent a payment that never
 * happened — so they sit alongside it, on the same page.
 *
 * Hidden entirely when there are none, so a vendor with no channels connected
 * sees no trace of the feature.
 */
const ChannelOrderRow = ({ order }: { order: ChannelOrder }) => {
  const display = describeChannelOrder(order)
  const [tracking, setTracking] = useState("")
  const [carrier, setCarrier] = useState("")
  const [open, setOpen] = useState(false)

  const { mutate, isPending } = useRecordChannelShipment({
    onSuccess: () => {
      toast.success("Shipment recorded.")
      setOpen(false)
    },
    onError: (e) => toast.error(e?.message ?? "Could not record the shipment."),
  })

  return (
    <div className="flex flex-col gap-y-2 border-b border-ui-border-base py-3 last:border-b-0">
      <div className="flex items-start justify-between">
        <div className="flex flex-col">
          <Text size="small" weight="plus">
            {order.channel_id} · {order.external_id}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {new Date(order.placed_at).toLocaleDateString()}
            {order.buyer_name ? ` · ${order.buyer_name}` : ""}
          </Text>
          {display.netHint ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {display.netHint}
            </Text>
          ) : null}
          {display.warning ? (
            <Text
              size="xsmall"
              className={
                display.tone === "red" ? "text-ui-fg-error" : "text-ui-fg-subtle"
              }
            >
              {display.warning}
            </Text>
          ) : null}
        </div>
        <div className="flex items-center gap-x-3">
          <Text size="small">{display.amount}</Text>
          <Badge size="2xsmall" color={display.tone}>
            {display.status}
          </Badge>
        </div>
      </div>

      {!order.fulfilled ? (
        open ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              size="small"
              placeholder="Tracking number"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
            <Input
              size="small"
              placeholder="Carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
            <Button
              size="small"
              disabled={isPending}
              onClick={() =>
                mutate({
                  id: order.id,
                  tracking_number: tracking.trim() || undefined,
                  carrier: carrier.trim() || undefined,
                })
              }
            >
              {isPending ? "Saving…" : "Mark shipped"}
            </Button>
            <Button size="small" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
              Mark shipped
            </Button>
          </div>
        )
      ) : null}
    </div>
  )
}

export const ChannelOrders = () => {
  const { channelOrders } = useVendorChannelOrders()

  if (!channelOrders.length) return null

  return (
    <Container className="flex flex-col gap-y-2">
      <Heading level="h2">Sales channel orders</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Orders placed on connected marketplaces. Stock for these has already
        been drawn down from the same pool as your FBM sales.
      </Text>
      <div className="flex flex-col">
        {channelOrders.map((o) => (
          <ChannelOrderRow key={o.id} order={o} />
        ))}
      </div>
    </Container>
  )
}
