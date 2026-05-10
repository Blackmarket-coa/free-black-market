/**
 * Playbook recipe catalog.
 *
 * Code is the source of truth for the ten playbook recipes. The
 * `playbook` table is seeded from this catalog at boot via
 * `backend/src/scripts/seed-playbooks.ts`.
 */

import { STALL } from "./stall"
import { ATELIER } from "./atelier"
import { GROVE } from "./grove"
import { WORKSHOP } from "./workshop"
import { COMMONS } from "./commons"
import { CYCLE } from "./cycle"
import { KITCHEN } from "./kitchen"
import { HARVEST } from "./harvest"
import { HUB } from "./hub"
import { SERVICE } from "./service"

import type { PlaybookId, PlaybookRecipe } from "./types"

export const PLAYBOOK_RECIPES: Record<PlaybookId, PlaybookRecipe> = {
  stall: STALL,
  atelier: ATELIER,
  grove: GROVE,
  workshop: WORKSHOP,
  commons: COMMONS,
  cycle: CYCLE,
  kitchen: KITCHEN,
  harvest: HARVEST,
  hub: HUB,
  service: SERVICE,
}

export const PLAYBOOK_IDS: PlaybookId[] = Object.keys(PLAYBOOK_RECIPES) as PlaybookId[]

export const getRecipe = (id: PlaybookId): PlaybookRecipe => {
  const recipe = PLAYBOOK_RECIPES[id]
  if (!recipe) {
    throw new Error(`Unknown playbook id: ${id}`)
  }
  return recipe
}

export * from "./types"
