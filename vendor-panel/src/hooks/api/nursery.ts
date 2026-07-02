import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/client"

// ── Nursery listing attributes ──────────────────────────────────────────────

export const NURSERY_SUBTYPES = [
  "live_plant_liner",
  "live_plant_3_4in",
  "live_plant_1gal",
  "live_plant_3gal",
  "bare_root_dormant",
  "cuttings_pads_bulk",
  "divisions_pups_slips_bulk",
  "seed_packet",
  "dried_value_added_by_weight",
] as const

export type NurserySubtype = (typeof NURSERY_SUBTYPES)[number]

export interface NurseryAttribute {
  id: string
  seller_id: string
  product_id: string
  subtype: NurserySubtype
  edible_use?: string[] | null
  medicinal_use?: string[] | null
  hardiness_zone?: string | null
  propagation_method?: string | null
  channel_fit?: string[] | null
  cost_to_produce?: number | null
  tag_data?: Record<string, unknown> | null
}

export interface UpsertNurseryInput {
  product_id: string
  subtype: NurserySubtype
  edible_use?: string[]
  medicinal_use?: string[]
  hardiness_zone?: string
  propagation_method?: string
  channel_fit?: string[]
  cost_to_produce?: number
}

export const nurseryKeys = {
  all: ["nursery"] as const,
  attributes: () => [...nurseryKeys.all, "attributes"] as const,
  channels: () => [...nurseryKeys.all, "channels"] as const,
}

export const useNurseryProducts = () =>
  useQuery({
    queryKey: nurseryKeys.attributes(),
    queryFn: async () => {
      const res = await sdk.client.fetch("/vendor/nursery/products")
      return res as { attributes: NurseryAttribute[]; count: number }
    },
  })

export const useUpsertNurseryProduct = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpsertNurseryInput) => {
      const res = await sdk.client.fetch("/vendor/nursery/products", {
        method: "POST",
        body: input,
      })
      return res as { attribute: NurseryAttribute }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nurseryKeys.attributes() }),
  })
}

export const useDeleteNurseryProduct = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await sdk.client.fetch("/vendor/nursery/products/" + id, { method: "DELETE" })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nurseryKeys.attributes() }),
  })
}

// ── Per-channel wholesale pricing (vendor_customer_tier) ────────────────────

export interface ChannelTier {
  id: string
  name: string
  discount_percent: number
  payment_terms_days: number
  metadata?: { channel?: string; vertical?: string } | null
}

export interface ChannelOption {
  key: string
  label: string
}

export const useNurseryChannels = () =>
  useQuery({
    queryKey: nurseryKeys.channels(),
    queryFn: async () => {
      const res = await sdk.client.fetch("/vendor/nursery/channels")
      return res as { channels: ChannelOption[]; tiers: ChannelTier[] }
    },
  })

export const useCreateChannelTier = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      channel: string
      discountPercent: number
      paymentTermsDays?: number
      minMonthlyOrder?: number
    }) => {
      const res = await sdk.client.fetch("/vendor/nursery/channels", {
        method: "POST",
        body: input,
      })
      return res as { tier: ChannelTier }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: nurseryKeys.channels() }),
  })
}
