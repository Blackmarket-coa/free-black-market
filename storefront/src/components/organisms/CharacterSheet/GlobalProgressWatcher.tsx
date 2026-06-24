import { getCharacterSheet } from "@/lib/data/progression"
import { GlobalProgressClient } from "./GlobalProgressClient"

/**
 * Server wrapper mounted in the main layout: fetches the authenticated
 * character sheet once per navigation and hands the derived milestone signals
 * to the client watcher. Renders nothing for logged-out visitors.
 */
export async function GlobalProgressWatcher() {
  const character = await getCharacterSheet()
  if (!character) return null

  const overallLevel = character.tracks.reduce(
    (max, t) => Math.max(max, t.level),
    0
  )

  return (
    <GlobalProgressClient
      overallLevel={overallLevel}
      titleCount={character.titles.length}
      unlockedCount={character.unlockedFeatures?.length ?? 0}
    />
  )
}
