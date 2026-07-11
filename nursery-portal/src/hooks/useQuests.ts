import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import { MOCK_QUEST_CATALOG, MOCK_QUEST_ENROLLMENTS } from "@/lib/mock/data"
import type {
  QuestCatalogEntry,
  QuestEnrollment,
  QuestEnrollmentItem,
} from "@/types"

// The vendor-quest backend routes are LIVE (backend/src/api/vendor/quests):
//   GET    /vendor/quests                  → { quests, count }
//   GET    /vendor/quests/enrollments      → { enrollments, count }
//   POST   /vendor/quests/enrollments      { quest_key } → { enrollment }
//   DELETE /vendor/quests/enrollments/:id  → { enrollment } (status DROPPED)

export interface QuestCatalogData {
  quests: QuestCatalogEntry[]
  count: number
}

export interface QuestEnrollmentsData {
  enrollments: QuestEnrollmentItem[]
  count: number
}

// Mutable copy of the enrollment fixtures so enroll/drop feel real in mock
// mode — the real store is the backend, reached once USE_MOCK_DATA flips.
let mockEnrollments: QuestEnrollmentItem[] = [...MOCK_QUEST_ENROLLMENTS]

// GET /vendor/quests — the browsable catalog (pure config; cache aggressively)
export function useQuestCatalog() {
  return useQuery<QuestCatalogData>({
    queryKey: ["quests", "catalog"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return mockResolve({
          quests: MOCK_QUEST_CATALOG,
          count: MOCK_QUEST_CATALOG.length,
        })
      }
      const { data } = await api.get("/vendor/quests")
      return data
    },
    staleTime: 5 * 60_000,
  })
}

// GET /vendor/quests/enrollments — each ACTIVE enrollment re-evaluated live
export function useQuestEnrollments() {
  return useQuery<QuestEnrollmentsData>({
    queryKey: ["quests", "enrollments"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        return mockResolve({
          enrollments: mockEnrollments,
          count: mockEnrollments.length,
        })
      }
      const { data } = await api.get("/vendor/quests/enrollments")
      return data
    },
  })
}

// POST /vendor/quests/enrollments { quest_key } — opt in (never auto-enrolled)
export function useEnrollQuest() {
  const queryClient = useQueryClient()
  return useMutation<QuestEnrollment, Error, string>({
    mutationFn: async (quest_key) => {
      if (USE_MOCK_DATA) {
        const enrollment: QuestEnrollment = {
          id: `enr_mock_${quest_key}`,
          seller_id: "node_ga",
          quest_key,
          status: "ACTIVE",
          current_stage: 0,
          collective_id: null,
          enrolled_at: new Date().toISOString(),
          dropped_at: null,
          completed_at: null,
        }
        mockEnrollments = [...mockEnrollments, { enrollment, evaluation: null }]
        return mockResolve(enrollment)
      }
      const { data } = await api.post("/vendor/quests/enrollments", { quest_key })
      return data.enrollment
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["quests", "enrollments"] }),
  })
}

// DELETE /vendor/quests/enrollments/:id — drop (never deletes substrate)
export function useDropQuest() {
  const queryClient = useQueryClient()
  return useMutation<QuestEnrollment, Error, string>({
    mutationFn: async (enrollmentId) => {
      if (USE_MOCK_DATA) {
        const item = mockEnrollments.find((e) => e.enrollment.id === enrollmentId)
        if (!item) throw new Error("Enrollment not found")
        const dropped: QuestEnrollment = {
          ...item.enrollment,
          status: "DROPPED",
          dropped_at: new Date().toISOString(),
        }
        mockEnrollments = mockEnrollments.map((e) =>
          e.enrollment.id === enrollmentId
            ? { enrollment: dropped, evaluation: null }
            : e
        )
        return mockResolve(dropped)
      }
      const { data } = await api.delete(`/vendor/quests/enrollments/${enrollmentId}`)
      return data.enrollment
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["quests", "enrollments"] }),
  })
}
