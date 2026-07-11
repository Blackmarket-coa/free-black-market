import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_QUEST_CATALOG, MOCK_QUEST_ENROLLMENTS } from "@/lib/mock/data"
import type { QuestCatalogEntry, QuestEnrollmentItem } from "@/types"

// GET /vendor/quests → { quests, count }
// Pure quest config: requirements (tagged), stages, gatekeeper, disclaimer —
// so a maker can see what a quest needs BEFORE opting in.
export function useQuestCatalog() {
  return useQuery<QuestCatalogEntry[]>({
    queryKey: ["quests", "catalog"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_QUEST_CATALOG)
      const { data } = await api.get("/vendor/quests")
      return data.quests
    },
    staleTime: 5 * 60_000, // catalog is config, changes rarely
  })
}

// GET /vendor/quests/enrollments → { enrollments: [{ enrollment, evaluation }], count }
// ACTIVE enrollments are re-evaluated against the live substrate server-side;
// `evaluation` is null for DROPPED/COMPLETE. (POST same path with { quest_key }
// to opt in — wired when the enroll flow ships.)
export function useQuestEnrollments() {
  return useQuery<QuestEnrollmentItem[]>({
    queryKey: ["quests", "enrollments"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_QUEST_ENROLLMENTS)
      const { data } = await api.get("/vendor/quests/enrollments")
      return data.enrollments
    },
    staleTime: 30_000,
  })
}
