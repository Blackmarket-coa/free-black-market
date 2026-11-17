/**
 * Playbook recipe catalog.
 *
 * Code is the source of truth for the playbook recipes. The `playbook`
 * table is seeded from this catalog at boot by the module's loader
 * (`../loaders/seed-registry.ts`, missing rows only);
 * `backend/src/scripts/seed-playbooks.ts` pushes code changes over rows
 * that already exist.
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
import { CREATOR } from "./creator"

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
  creator: CREATOR,
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
