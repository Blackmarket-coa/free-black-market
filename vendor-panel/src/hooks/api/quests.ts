import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../lib/client"

// ── Types (mirror the backend vendor-quest engine) ──────────────────────────

export type RequirementTag = "platform" | "assisted" | "vendor-supplied" | "outside-fbm"

export interface CatalogRequirement {
  key: string
  label: string
  tag: RequirementTag
  needs: string[]
  note?: string
}

export interface CatalogStage {
  key: string
  label: string
  order: number
  description?: string
}

export interface QuestCatalogEntry {
  key: string
  category: string
  title: string
  outcome: string
  type: "individual" | "collective"
  gatekeeper: string
  disclaimer: string
  health_claims_guardrail: boolean
  uses_fields: string[]
  has_packet: boolean
  requirements: CatalogRequirement[]
  stages: CatalogStage[]
}

export interface QuestEnrollment {
  id: string
  seller_id: string
  quest_key: string
  status: "ACTIVE" | "DROPPED" | "COMPLETE"
  current_stage: number
  enrolled_at: string
  dropped_at?: string | null
  completed_at?: string | null
}

export interface EvaluatedStage {
  key: string
  label: string
  order: number
  open: boolean
  missing: string[]
}

export interface EvaluatedRequirement {
  key: string
  label: string
  tag: RequirementTag
  status: "satisfied" | "unsatisfied" | "unavailable" | "checklist"
  note?: string
}

export interface QuestEvaluation {
  quest_key: string
  stages: EvaluatedStage[]
  current_stage_index: number
  current_stage_key: string | null
  final_gate_open: boolean
  packet_available: boolean
  requirements: EvaluatedRequirement[]
}

export interface EnrollmentWithEvaluation {
  enrollment: QuestEnrollment
  evaluation: QuestEvaluation | null
}

export interface PacketExport {
  quest_key: string
  packet_key: string
  title: string
  gatekeeper: string
  disclaimer: string
  generated_at: string
  sections: { key: string; title: string; available: boolean; data: unknown; note?: string }[]
  remaining_items: string[]
}

// ── Query keys ──────────────────────────────────────────────────────────────

export const questKeys = {
  all: ["quests"] as const,
  catalog: () => [...questKeys.all, "catalog"] as const,
  enrollments: () => [...questKeys.all, "enrollments"] as const,
  enrollment: (id: string) => [...questKeys.all, "enrollment", id] as const,
}

// ── Catalog ───────────────────────────────────────────────────────────────

export const useQuestCatalog = () => {
  return useQuery({
    queryKey: questKeys.catalog(),
    queryFn: async () => {
      const res = await sdk.client.fetch("/vendor/quests")
      return res as { quests: QuestCatalogEntry[]; count: number }
    },
  })
}

// ── Enrollments ─────────────────────────────────────────────────────────────

export const useQuestEnrollments = () => {
  return useQuery({
    queryKey: questKeys.enrollments(),
    queryFn: async () => {
      const res = await sdk.client.fetch("/vendor/quests/enrollments")
      return res as { enrollments: EnrollmentWithEvaluation[]; count: number }
    },
  })
}

export const useQuestEnrollment = (id: string) => {
  return useQuery({
    queryKey: questKeys.enrollment(id),
    queryFn: async () => {
      const res = await sdk.client.fetch("/vendor/quests/enrollments/" + id)
      return res as { enrollment: QuestEnrollment; evaluation: QuestEvaluation | null }
    },
    enabled: !!id,
  })
}

export const useEnrollQuest = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (quest_key: string) => {
      const res = await sdk.client.fetch("/vendor/quests/enrollments", {
        method: "POST",
        body: { quest_key },
      })
      return res as { enrollment: QuestEnrollment }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questKeys.enrollments() })
    },
  })
}

export const useDropQuest = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      await sdk.client.fetch("/vendor/quests/enrollments/" + enrollmentId, {
        method: "DELETE",
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questKeys.enrollments() })
    },
  })
}

export const useGeneratePacket = () => {
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const res = await sdk.client.fetch(
        "/vendor/quests/enrollments/" + enrollmentId + "/packet",
        { method: "POST", body: {} }
      )
      return res as { packet: PacketExport; html: string }
    },
  })
}

// ── Nursery profit-per-sqft (decision-support; no quest required) ───────────

export interface ProfitPerSqFtInput {
  label?: string
  sellPrice: number
  costToProduce: number
  footprintSqFtPerUnit: number
  weeksToSell: number
  stackLevels?: number
}

export interface ProfitPerSqFtResult {
  label?: string
  profitPerUnit: number
  unitsPerSqFt: number
  turnsPerYear: number
  profitPerSqFtPerTurn: number
  annualProfitPerSqFt: number
}

export const useProfitPerSqFt = () => {
  return useMutation({
    mutationFn: async (rows: ProfitPerSqFtInput[]) => {
      const res = await sdk.client.fetch("/vendor/nursery/profit-per-sqft", {
        method: "POST",
        body: { rows },
      })
      return res as { ranking: ProfitPerSqFtResult[]; count: number }
    },
  })
}
