/**
 * Project manifest catalog.
 *
 * Code is the source of truth for v0 manifests. Adding a vertical
 * means adding a file here, registering it in the catalog, and (when
 * persistence lands in v0.1) seeding it into the `project_manifest`
 * table at boot — same pattern as playbook recipes and listing-types.
 *
 * Each entry is parsed against `ProjectManifestSchema` at import time
 * (the manifest files themselves call `.parse(...)`), so a malformed
 * manifest refuses to load the module.
 */

import { YARD_SCRAP_NURSERY_MANIFEST } from "./yard-scrap-nursery"
import { TOOL_LIBRARY_MANIFEST } from "./tool-library"
import { REPAIR_CAFE_MANIFEST } from "./repair-cafe"
import type { ProjectManifestRecipe } from "./types"

export type ManifestSlug = "yard-scrap-nursery" | "tool-library" | "repair-cafe"

export const PROJECT_MANIFESTS: Record<ManifestSlug, ProjectManifestRecipe> = {
  "yard-scrap-nursery": YARD_SCRAP_NURSERY_MANIFEST,
  "tool-library": TOOL_LIBRARY_MANIFEST,
  "repair-cafe": REPAIR_CAFE_MANIFEST,
}

export const MANIFEST_SLUGS: ManifestSlug[] = Object.keys(
  PROJECT_MANIFESTS
) as ManifestSlug[]

export const getManifest = (slug: ManifestSlug): ProjectManifestRecipe => {
  const manifest = PROJECT_MANIFESTS[slug]
  if (!manifest) {
    throw new Error(`Unknown project manifest slug: ${slug}`)
  }
  return manifest
}

export * from "./types"
