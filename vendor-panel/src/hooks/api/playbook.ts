import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchQuery, getAuthToken } from "../../lib/client"
import { usersQueryKeys } from "./users"
import type { Playbook } from "../../providers/playbook-provider"

export type PlaybookAssignment = {
  id: string
  seller_id: string
  playbook_id: string
  recipe_id: Exclude<Playbook, "default">
  q1_size: string | null
  q2_governance: string | null
  q3_offering: string | null
  recommended_recipe_id: string | null
  overridden: boolean
  migrated_from: string | null
  assigned_at: string | null
}

export type AssignPlaybookBody = {
  recipe_id: Exclude<Playbook, "default">
  answers?: {
    size: string
    governance: string
    offering: string
  }
  recommended_recipe_id?: Exclude<Playbook, "default">
  overridden?: boolean
}

export const playbookQueryKeys = {
  assignment: ["playbook", "assignment", "me"] as const,
}

export const usePlaybookAssignment = () => {
  return useQuery<{ playbook_assignment: PlaybookAssignment | null }>({
    queryKey: playbookQueryKeys.assignment,
    queryFn: () => fetchQuery("/vendor/playbook/assign", { method: "GET" }),
    enabled: Boolean(getAuthToken()),
    retry: false,
  })
}

export const useAssignPlaybook = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: AssignPlaybookBody) =>
      fetchQuery("/vendor/playbook/assign", {
        method: "POST",
        body,
      }) as Promise<{ playbook_assignment: PlaybookAssignment }>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playbookQueryKeys.assignment })
      // The seller's resolved playbook (used by usePlaybook()) is derived
      // from seller fields fetched via useMe(); refresh it so the gate
      // and any consumer (banner, sidebar) re-render with the new value.
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.me() })
    },
  })
}
