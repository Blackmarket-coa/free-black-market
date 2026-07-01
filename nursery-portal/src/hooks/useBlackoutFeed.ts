import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import {
  MOCK_BLACKOUT_NODE,
  MOCK_BLACKOUT_NETWORK,
  MOCK_PROPOSALS,
} from "@/lib/mock/data"
import type { BlackoutMessage, GovernanceProposal } from "@/types"

type Feed = "node" | "network"

// GET /api/blackout/node-room/messages | /network-all/messages
// All Blackout calls are proxied through the FBM backend; the bot token never
// reaches the browser. Polls every 30s for new messages.
export function useBlackoutFeed(feed: Feed) {
  return useQuery<BlackoutMessage[]>({
    queryKey: ["blackout", feed],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return mockResolve(feed === "node" ? MOCK_BLACKOUT_NODE : MOCK_BLACKOUT_NETWORK)
      }
      const path =
        feed === "node"
          ? "/blackout/node-room/messages"
          : "/blackout/network-all/messages"
      const { data } = await api.get(path)
      return data
    },
    refetchInterval: 30_000,
  })
}

// GET /api/blackout/governance/proposals
export function useGovernanceProposals() {
  return useQuery<GovernanceProposal[]>({
    queryKey: ["blackout", "governance"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PROPOSALS)
      const { data } = await api.get("/blackout/governance/proposals")
      return data
    },
  })
}
