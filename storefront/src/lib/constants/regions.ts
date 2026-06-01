/**
 * Regions — the RPG "world map" overlay on top of the marketplace taxonomy.
 *
 * The Solarpunk-MMORPG vision replaces flat categories with named Regions you
 * "travel" to. This is a *presentational* remap of the 10 canonical
 * cms-blueprint product types onto 6 themed Regions — it does NOT change the
 * backend taxonomy. Each region links out to the existing `/categories` /
 * `/shop` surfaces filtered by the underlying blueprint type handles.
 *
 * Colors are pulled from the existing Solarpunk palette tokens (see
 * `src/app/colors.css`) so regions feel native to the established theme.
 */

export type Region = {
  /** URL-safe region key. */
  slug: string
  /** Display name. */
  label: string
  /** One-line flavor text. */
  tagline: string
  /** Emoji used as the region glyph on cards. */
  emoji: string
  /** Tailwind accent class (border/text) drawn from the solarpunk ramp. */
  accent: string
  /**
   * Underlying cms-blueprint product-type handles this region surfaces.
   * Used to build links into the existing category pages.
   */
  blueprintTypes: string[]
}

export const REGIONS: Region[] = [
  {
    slug: "agriculture-grove",
    label: "Agriculture Grove",
    tagline: "Seeds, plants, livestock, and fresh food.",
    emoji: "🌱",
    accent: "green-700",
    blueprintTypes: ["food", "land-access"],
  },
  {
    slug: "artisan-district",
    label: "Artisan District",
    tagline: "Handmade goods, crafts, and repaired treasures.",
    emoji: "🎨",
    accent: "amber-600",
    blueprintTypes: ["circular-economy", "mutual-aid"],
  },
  {
    slug: "industrial-quarter",
    label: "Industrial Quarter",
    tagline: "Tools, machinery, CNC, and infrastructure.",
    emoji: "🏭",
    accent: "green-800",
    blueprintTypes: ["tools-infrastructure"],
  },
  {
    slug: "creator-commons",
    label: "Creator Commons",
    tagline: "Streaming, media, software, and digital services.",
    emoji: "🎬",
    accent: "amber-500",
    blueprintTypes: ["digital-services", "community-events"],
  },
  {
    slug: "innovation-lab",
    label: "Innovation Lab",
    tagline: "Electronics, mesh networks, and experimental projects.",
    emoji: "🔬",
    accent: "green-600",
    blueprintTypes: ["electronics-networks", "experimental"],
  },
  {
    slug: "investment-guild",
    label: "Investment Guild",
    tagline: "Crowdfunding, micro-investments, and memberships.",
    emoji: "💰",
    accent: "amber-700",
    blueprintTypes: ["membership"],
  },
]

/** Map a cms-blueprint type handle to the Region that surfaces it. */
export function regionForBlueprintType(typeHandle: string): Region | undefined {
  return REGIONS.find((r) => r.blueprintTypes.includes(typeHandle))
}
