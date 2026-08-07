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
  metadata?: { roles?: string[]; resources?: string[] } | null
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
  /** All roles the seller selected (primary is `recipe_id`). */
  roles?: Exclude<Playbook, "default">[]
  /** Resources reported in the resource quiz. */
  resources?: string[]
  /**
   * Optional free text for why the seller is changing playbooks. Recorded on
   * the transition; never required, never inferred.
   */
  reason?: string
}

export type ProgressionEngine = "facility" | "governance" | "land" | "audience"

export type ProgressionKind = "replace" | "add_role"

export type StrandedListing = {
  id: string
  title: string
  listing_type_id: string
}

export type ProgressionPreflight = {
  stranded_listing_count: number
  stranded_listings: StrandedListing[]
  /**
   * False when the listing read failed. A zero count is only meaningful when
   * this is true — see the note on `listings_checked` below.
   */
  checked: boolean
}

export type Progression = {
  from: Exclude<Playbook, "default">
  to: Exclude<Playbook, "default">
  kind: ProgressionKind
  engines: ProgressionEngine[]
  headline: string
  ceiling: string
  real_world_prerequisites: string[]
  quest_key?: string
  to_display_name: string
  to_social_form: string
  to_member_model: string
  diff: {
    featuresGained: string[]
    featuresLost: string[]
    listingTypesGained: string[]
    listingTypesLost: string[]
    commissionDelta: number
  }
  preflight?: ProgressionPreflight
}

export type ProgressionGroup = {
  engine: ProgressionEngine
  label: string
  edges: Progression[]
}

export type PlaybookTransition = {
  id: string
  from_recipe_id: string | null
  to_recipe_id: string
  kind: ProgressionKind | null
  engines: ProgressionEngine[] | null
  matched_progression: boolean
  reason: string | null
  stranded_listing_count: number
  occurred_at: string
}

export type ProgressionsResponse = {
  current_playbook: Exclude<Playbook, "default"> | null
  groups: ProgressionGroup[]
  progressions: Progression[]
  /** True when the current playbook is the end of its ladders (today: hub). */
  is_terminal: boolean
  history: PlaybookTransition[]
  /**
   * False when the seller's listings could not be read. The stranded counts are
   * zero in that case and must not be rendered as "nothing would be affected".
   */
  listings_checked: boolean
}

export const playbookQueryKeys = {
  assignment: ["playbook", "assignment", "me"] as const,
  progressions: ["playbook", "progressions", "me"] as const,
}

export const usePlaybookAssignment = () => {
  return useQuery<{ playbook_assignment: PlaybookAssignment | null }>({
    queryKey: playbookQueryKeys.assignment,
    queryFn: () => fetchQuery("/vendor/playbook/assign", { method: "GET" }),
    enabled: Boolean(getAuthToken()),
    retry: false,
  })
}

/**
 * Where the seller's current playbook commonly leads.
 *
 * `enabled` is opt-in on purpose: this is fetched by the surface the seller
 * opened, never speculatively on the dashboard. Nothing about progressions
 * should reach a vendor who did not go looking.
 */
export const usePlaybookProgressions = (options?: {
  enabled?: boolean
  /**
   * Ask where a playbook the seller is *considering* would lead, instead of
   * their current one. Used by the onboarding picker, where no assignment
   * exists yet. Listing preflight is skipped for a hypothetical origin.
   */
  from?: Exclude<Playbook, "default">
}) => {
  return useQuery<ProgressionsResponse>({
    queryKey: [...playbookQueryKeys.progressions, options?.from ?? "current"],
    queryFn: () =>
      fetchQuery(
        options?.from
          ? `/vendor/playbook/progressions?from=${options.from}`
          : "/vendor/playbook/progressions",
        { method: "GET" }
      ),
    enabled: Boolean(getAuthToken()) && (options?.enabled ?? true),
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
      }) as Promise<{
        playbook_assignment: PlaybookAssignment
        transition: PlaybookTransition | null
        preflight: ProgressionPreflight | null
      }>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: playbookQueryKeys.assignment })
      queryClient.invalidateQueries({ queryKey: playbookQueryKeys.progressions })
      // The seller's resolved playbook (used by usePlaybook()) is derived
      // from seller fields fetched via useMe(); refresh it so the gate
      // and any consumer (banner, sidebar) re-render with the new value.
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.me() })
    },
  })
}
