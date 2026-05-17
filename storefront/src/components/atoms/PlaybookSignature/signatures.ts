/**
 * Visual-signature taxonomy for the ten playbooks.
 *
 * This module is intentionally framework-free: it only exports the
 * playbook id union, the display labels, and a stable order. The actual
 * SVG shapes live next to the React component in
 * `PlaybookSignature.tsx` so each glyph stays as JSX (which the rest of
 * the storefront uses for inline icons; see
 * `app/[locale]/(main)/vendor-types/page.tsx` for the same pattern).
 *
 * Keep the id union in lockstep with
 * `backend/src/modules/playbook/recipes/types.ts` — both code paths are
 * the source of truth for which playbooks exist.
 */

export type PlaybookId =
  | "stall"
  | "atelier"
  | "grove"
  | "workshop"
  | "commons"
  | "cycle"
  | "kitchen"
  | "harvest"
  | "hub"
  | "service"

export const PLAYBOOK_IDS: readonly PlaybookId[] = [
  "stall",
  "atelier",
  "grove",
  "workshop",
  "commons",
  "cycle",
  "kitchen",
  "harvest",
  "hub",
  "service",
] as const

/** Display labels for the ten playbooks. */
export const PLAYBOOK_LABELS: Record<PlaybookId, string> = {
  stall: "Stall",
  atelier: "Atelier",
  grove: "Grove",
  workshop: "Workshop",
  commons: "Commons",
  cycle: "Cycle",
  kitchen: "Kitchen",
  harvest: "Harvest",
  hub: "Hub",
  service: "Service",
}

export function isPlaybookId(value: unknown): value is PlaybookId {
  return (
    typeof value === "string" &&
    (PLAYBOOK_IDS as readonly string[]).includes(value)
  )
}

export function getPlaybookLabel(id: PlaybookId | string | null | undefined): string {
  if (isPlaybookId(id)) return PLAYBOOK_LABELS[id]
  return ""
}
