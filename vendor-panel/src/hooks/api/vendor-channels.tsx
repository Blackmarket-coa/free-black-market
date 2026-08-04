import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UseMutationOptions, UseQueryOptions } from "@tanstack/react-query"

import { FetchError } from "@medusajs/js-sdk"
import { fetchQuery } from "../../lib/client"

const VENDOR_CHANNELS_QUERY_KEY = "vendor_channels" as const

export type ChannelCapability =
  | "push_listing"
  | "push_inventory"
  | "pull_orders"
  | "push_fulfillment"

export type VendorChannel = {
  id: string
  display_name: string
  description: string
  /** Read from the adapter, so this is what will actually run. */
  capabilities: ChannelCapability[]
  /** False when the channel is catalogued but not shipped in this build. */
  available: boolean
  credential_hint: string
  credential_url: string
  connected: boolean
  enabled: boolean
  last_synced_at: string | null
  orders_synced_through: string | null
  last_error: string | null
  /**
   * Set while the connection is standing down after the channel refused us.
   * Resolves on its own; nothing for the vendor to do but wait.
   */
  throttled_until: string | null
  /**
   * The channel rejected the credentials. Does *not* resolve on its own — this
   * is the one state where the vendor has to act.
   */
  needs_reauth: boolean
}

export type VendorChannelsResponse = {
  channels: VendorChannel[]
}

export const useVendorChannels = (
  options?: Omit<
    UseQueryOptions<VendorChannelsResponse, FetchError>,
    "queryFn" | "queryKey"
  >
) => {
  const { data, ...rest } = useQuery({
    queryFn: () => fetchQuery("/vendor/channels", { method: "GET" }),
    queryKey: [VENDOR_CHANNELS_QUERY_KEY, "list"],
    retry: false,
    ...options,
  })

  const response = data as VendorChannelsResponse | undefined

  return { channels: response?.channels ?? [], ...rest }
}

export type ConnectChannelBody = {
  channel_id: string
  access_token: string
  api_base_url?: string
}

export type ConnectChannelResponse = {
  channel_id: string
  connected: boolean
  enabled: boolean
}

export const useConnectChannel = (
  options?: UseMutationOptions<
    ConnectChannelResponse,
    FetchError,
    ConnectChannelBody
  >
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body) =>
      fetchQuery("/vendor/channels", {
        method: "POST",
        body,
      }) as Promise<ConnectChannelResponse>,
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({
        queryKey: [VENDOR_CHANNELS_QUERY_KEY],
      })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

const CAPABILITY_LABELS: Record<ChannelCapability, string> = {
  push_listing: "Lists your products",
  push_inventory: "Syncs stock levels",
  pull_orders: "Imports orders",
  push_fulfillment: "Sends tracking back",
}

/**
 * What a channel will actually do, in the vendor's terms.
 *
 * Rendered from the adapter's declared capabilities rather than from a fixed
 * blurb per channel, because the two would drift and the vendor would be told
 * a channel does something it does not. Channels genuinely differ here — Faire
 * does not take fulfilment reporting yet — and saying so up front is better
 * than letting them discover it after connecting.
 */
export function describeCapabilities(
  capabilities: ChannelCapability[]
): string[] {
  return capabilities.map((c) => CAPABILITY_LABELS[c] ?? c)
}

export type ChannelStatus = {
  label: string
  tone: "green" | "orange" | "red" | "grey"
  /** Set when the vendor should do something. */
  hint: string | null
}

/**
 * The one line summarising where a connection stands.
 *
 * An errored connection is called out ahead of everything else: a channel that
 * silently stopped syncing is worse than one that was never connected, because
 * the vendor believes their stock and orders are flowing when they are not.
 * Paused is distinguished from errored for the same reason — one they chose,
 * the other happened to them.
 *
 * Phase 12 adds two states that would otherwise both render as "Needs
 * attention", and the difference between them is the whole point: one asks the
 * vendor to do something and one asks them to wait. Collapsing them means
 * either a vendor re-pastes a working token to fix a rate limit, or ignores a
 * dead token believing it will clear itself.
 */
export function describeChannelStatus(
  channel: VendorChannel,
  now: Date = new Date()
): ChannelStatus {
  if (!channel.available) {
    return {
      label: "Unavailable",
      tone: "grey",
      hint: "This channel is not enabled on this marketplace.",
    }
  }
  if (!channel.connected) {
    return { label: "Not connected", tone: "grey", hint: null }
  }
  // Ahead of `last_error`, which is set alongside it and would otherwise render
  // the backoff's own message as an unqualified failure.
  if (channel.needs_reauth) {
    return {
      label: "Reconnect needed",
      tone: "red",
      hint: "This channel rejected your access token. Enter a new one to resume syncing.",
    }
  }
  const standDownEnds = channel.throttled_until
    ? new Date(channel.throttled_until)
    : null
  if (standDownEnds && standDownEnds.getTime() > now.getTime()) {
    return {
      label: "Rate limited",
      tone: "orange",
      hint: `${channel.display_name} asked us to slow down. Syncing resumes ${standDownEnds.toLocaleString()}.`,
    }
  }
  if (channel.last_error) {
    return {
      label: "Needs attention",
      tone: "red",
      hint: channel.last_error,
    }
  }
  if (!channel.enabled) {
    return {
      label: "Paused",
      tone: "orange",
      hint: "Syncing is off. Your listings stay as they are.",
    }
  }
  return {
    label: "Connected",
    tone: "green",
    hint: channel.last_synced_at
      ? `Last synced ${new Date(channel.last_synced_at).toLocaleString()}`
      : "Waiting for the first sync.",
  }
}
