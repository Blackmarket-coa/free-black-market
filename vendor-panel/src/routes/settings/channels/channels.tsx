import { useState } from "react"
import { Badge, Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"

import {
  describeCapabilities,
  describeChannelStatus,
  useConnectChannel,
  useVendorChannels,
  type VendorChannel,
} from "../../../hooks/api/vendor-channels"
import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"

/**
 * Connect a vendor's own catalogue to an outbound sales channel.
 *
 * The list shows every channel, not only connected ones — this screen is also
 * where a vendor finds out a channel exists, and one that renders nothing until
 * you have already connected something is not a way in.
 */
const ConnectForm = ({
  channel,
  onDone,
  onCancel,
}: {
  channel: VendorChannel
  onDone: () => void
  onCancel: () => void
}) => {
  const [token, setToken] = useState("")
  const { mutate, isPending } = useConnectChannel({
    onSuccess: () => {
      toast.success(`${channel.display_name} connected.`)
      onDone()
    },
    onError: (error) => {
      // The backend distinguishes an unknown channel, an unavailable one and a
      // missing token; surfacing its message beats a generic failure, since
      // each needs a different thing from the vendor.
      toast.error(error?.message ?? "Could not connect this channel.")
    },
  })

  return (
    <div className="flex flex-col gap-y-2 pt-2">
      <Text size="xsmall" className="text-ui-fg-subtle">
        {channel.credential_hint}{" "}
        <a
          href={channel.credential_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ui-fg-interactive"
        >
          Open {channel.display_name}
        </a>
      </Text>
      <Input
        // `password` so a token is not left readable on a shared screen while
        // it is being pasted.
        type="password"
        autoComplete="off"
        placeholder="Access token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <div className="flex items-center gap-x-2">
        <Button
          size="small"
          disabled={!token.trim() || isPending}
          onClick={() =>
            mutate({ channel_id: channel.id, access_token: token.trim() })
          }
        >
          {isPending ? "Connecting…" : "Connect"}
        </Button>
        <Button size="small" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

const ChannelCard = ({ channel }: { channel: VendorChannel }) => {
  const [connecting, setConnecting] = useState(false)
  const status = describeChannelStatus(channel)
  const capabilities = describeCapabilities(channel.capabilities)

  return (
    <Container className="flex flex-col gap-y-3">
      <div className="flex items-start justify-between">
        <div className="flex flex-col">
          <Heading level="h2">{channel.display_name}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {channel.description}
          </Text>
        </div>
        <Badge size="2xsmall" color={status.tone}>
          {status.label}
        </Badge>
      </div>

      {capabilities.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {capabilities.map((label) => (
            <Text key={label} size="xsmall" className="text-ui-fg-subtle">
              • {label}
            </Text>
          ))}
        </div>
      ) : null}

      {status.hint ? (
        <Text
          size="xsmall"
          className={
            status.tone === "red" ? "text-ui-fg-error" : "text-ui-fg-subtle"
          }
        >
          {status.hint}
        </Text>
      ) : null}

      {channel.available ? (
        connecting ? (
          <ConnectForm
            channel={channel}
            onDone={() => setConnecting(false)}
            onCancel={() => setConnecting(false)}
          />
        ) : (
          <div>
            <Button
              size="small"
              variant={channel.connected ? "secondary" : "primary"}
              onClick={() => setConnecting(true)}
            >
              {/* Re-entering a token is what a vendor does when one expires,
                  so the affordance stays available after connecting. */}
              {channel.connected ? "Update credentials" : "Connect"}
            </Button>
          </div>
        )
      ) : null}
    </Container>
  )
}

export const ChannelSettings = () => {
  const { channels, isPending } = useVendorChannels()

  if (isPending) {
    return (
      <SingleColumnPageSkeleton
        sections={2}
        showJSON={false}
        showMetadata={false}
      />
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-col gap-y-1">
        <Heading level="h1">Sales channels</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          List your products on other marketplaces and bring their orders back
          into FBM. Your stock stays in one place.
        </Text>
      </Container>

      {channels.length === 0 ? (
        <Container>
          <Text size="small" className="text-ui-fg-subtle">
            No sales channels are available on this marketplace yet.
          </Text>
        </Container>
      ) : (
        channels.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} />
        ))
      )}
    </div>
  )
}
