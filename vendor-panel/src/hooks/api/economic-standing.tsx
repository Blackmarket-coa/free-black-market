import { useQuery } from "@tanstack/react-query"
import { fetchQuery } from "../../lib/client"

export interface EconomicStanding {
  mxid: string | null
  coalition_credits: {
    available: number
    pending: number
    currency: string
    last_settlement_at: string | null
  }
  payouts: {
    pending_amount: number
    currency: string
    next_payout_at: string | null
  }
  vendor_sales: {
    period: string
    gross_volume: number
    net_volume: number
    currency: string
  }
  creator_rewards: {
    eligible: boolean
    program_keys: string[]
  }
  evaluated_at: string
}

/**
 * Fetch the vendor's economic standing (Coalition Credits, payouts, sales)
 * from the FBM-internal `/vendor/economic-standing` route. Refetches every 60s.
 */
export const useEconomicStanding = () => {
  const { data, ...rest } = useQuery<EconomicStanding>({
    queryKey: ["economic-standing"],
    queryFn: () =>
      fetchQuery("/vendor/economic-standing", {
        method: "GET",
      }) as Promise<EconomicStanding>,
    refetchInterval: 60_000,
  })

  return { standing: data, ...rest }
}
