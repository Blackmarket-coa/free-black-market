import { z } from "zod"
import { PluginCategory } from "./models/plugin-listing"

/**
 * The shared extension manifest (W3, consolidation D6) — the wire shape an
 * authoring tool (Forge) submits inside `creator_listing.manifest` and FBM
 * publishes into the plugin registry.
 *
 * TYPE SOURCE OF TRUTH: the Blackout host's plugin protocol at
 * `blackout/packages/blackout-protocol/src/plugins/index.ts` (`PluginManifest`
 * + `PLUGINS_PROTOCOL_VERSION`). The artifact-kind and capability literals
 * below are transcribed from it and must be kept in sync manually — same
 * contract style as `docs/contracts/mas-identity-consumer.md` mirroring its
 * blackout canonical. Cross-repo contract: `docs/contracts/extension-manifest.md`.
 *
 * Host-version compatibility bounds ride in the FBM-namespaced `fbm` block
 * (the Blackout manifest has no host-version fields; Blackout ignores unknown
 * fields, so the block travels harmlessly inside the distribution manifest).
 *
 * Pure module — zod only, no I/O, no service imports — so every rule is
 * unit-testable without a container (the compat.ts/hooks.ts idiom).
 */

/** Transcribed from blackout `PluginArtifactKind` (14 kinds). */
export const EXTENSION_ARTIFACT_KINDS = [
  "theme",
  "manifest_plugin",
  "code_plugin",
  "asset_bundle",
  "coalition_kit",
  "profile_cosmetic",
  "sound_pack",
  "community_template",
  "stream_asset",
  "vault_item",
  "ai_persona",
  "automation_recipe",
  "privacy_tool",
  "twitch_extension_compat",
] as const

export type ExtensionArtifactKind = (typeof EXTENSION_ARTIFACT_KINDS)[number]

/** Transcribed from blackout `PluginCapability` (10 capabilities). */
export const EXTENSION_CAPABILITIES = [
  "shell.panel.read",
  "shell.panel.write",
  "message.read",
  "message.compose",
  "storage.read",
  "storage.write",
  "http.fetch",
  "ai.inference",
  "twitch.ext.identityShare",
  "twitch.ext.subscriptionStatus",
] as const

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number]

/** Provider id Blackout's marketplace layer knows FBM by. */
export const FBM_PROVIDER_ID = "freeblackmarket"

/** Same rules the seller listings routes enforce on `creator_listing.version`. */
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i
/** Same shape as the seller listings slug rule (also `plugin_listing.slug`). */
export const PLUGIN_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
const MANIFEST_ID_RE = /^[a-z0-9][a-z0-9.-]{2,127}$/i
const SHA256_RE = /^[a-f0-9]{64}$/i

const surfaceEntry = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  iconUrl: z.string().max(2048).optional(),
  order: z.number().int().optional(),
})

const homepageCard = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  iconUrl: z.string().max(2048).optional(),
  to: z.string().max(2048).optional(),
  order: z.number().int().optional(),
})

const pinnedNav = z.object({
  label: z.string().min(1).max(64),
  iconUrl: z.string().max(2048).optional(),
  to: z.string().max(2048).optional(),
  order: z.number().int().optional(),
})

const pluginDen = z.object({
  purpose: z.string().min(1).max(64),
  denType: z.string().max(64).optional(),
  name: z.string().max(120).optional(),
})

/**
 * FBM-namespaced extension block: where the registry's host-compat bounds and
 * category override travel. Free-form extras (e.g. `dataSource`) pass through.
 */
const fbmBlock = z
  .object({
    minHostVersion: z.string().regex(SEMVER_RE).optional(),
    maxHostVersion: z.string().regex(SEMVER_RE).optional(),
    category: z.nativeEnum(PluginCategory).optional(),
  })
  .passthrough()

/**
 * Authoring-time manifest (what Forge submits). `listing` and `sha256` are
 * optional here: the server injects the listing ref at publish, and only
 * `code_plugin` artifacts require a bundle hash up front.
 * `.passthrough()` keeps unknown future fields intact — the canonical hash is
 * over what was authored plus server-injected fields, never a stripped copy.
 */
export const ExtensionManifestSchema = z
  .object({
    id: z.string().regex(MANIFEST_ID_RE, "id must be reverse-DNS-ish (a-z0-9.-)"),
    name: z.string().min(1).max(120),
    version: z.string().regex(SEMVER_RE),
    protocolVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    artifactKind: z.enum(EXTENSION_ARTIFACT_KINDS),
    capabilities: z.array(z.enum(EXTENSION_CAPABILITIES)).max(16).default([]),
    listing: z
      .object({
        providerId: z.string().min(1).max(64),
        providerListingId: z.string().min(1).max(128),
        publicSlug: z.string().regex(PLUGIN_SLUG_RE).optional(),
      })
      .optional(),
    entry: z.string().max(2048).optional(),
    sha256: z.string().regex(SHA256_RE).optional(),
    description: z.string().max(2000).optional(),
    homepageCard: homepageCard.optional(),
    pinnedNav: pinnedNav.optional(),
    rightPanel: surfaceEntry.optional(),
    mobileTab: surfaceEntry.optional(),
    pluginDens: z.array(pluginDen).max(8).optional(),
    fbm: fbmBlock.optional(),
  })
  .passthrough()

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>

/**
 * The marker predicate everything extension-related keys off: a listing is an
 * extension iff it claims a plugin slug OR its manifest declares an
 * artifactKind. Free-form manifests without either marker are untouched by
 * every W3 gate (dark/additive contract).
 */
export function isExtensionListing(input: {
  plugin_slug?: string | null
  manifest?: unknown
}): boolean {
  if (typeof input.plugin_slug === "string" && input.plugin_slug.length > 0) {
    return true
  }
  const manifest = input.manifest
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    "artifactKind" in manifest &&
    (manifest as Record<string, unknown>).artifactKind !== undefined &&
    (manifest as Record<string, unknown>).artifactKind !== null
  )
}

export type ManifestValidation =
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; errors: string[] }

/**
 * Validate an extension manifest. Publish mode additionally requires:
 *  - `manifest.version === listing.version` (neutralizes the `...manifest`
 *    spread-override footgun in the signing call),
 *  - a `sha256` for `code_plugin` artifacts (there are bundle bytes to bind),
 *  - a resolvable plugin slug (explicit `plugin_slug` or the listing slug).
 */
export function validateExtensionManifest(
  manifest: unknown,
  opts: {
    listingVersion?: string | null
    listingSlug?: string | null
    pluginSlug?: string | null
    forPublish?: boolean
  } = {}
): ManifestValidation {
  const parsed = ExtensionManifestSchema.safeParse(manifest)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`
      ),
    }
  }
  const errors: string[] = []
  if (opts.forPublish) {
    if (opts.listingVersion && parsed.data.version !== opts.listingVersion) {
      errors.push(
        `version: manifest version ${parsed.data.version} must equal the listing version ${opts.listingVersion}`
      )
    }
    if (parsed.data.artifactKind === "code_plugin" && !parsed.data.sha256) {
      errors.push("sha256: required for code_plugin artifacts")
    }
    const slug = resolvePluginSlug(opts)
    if (!slug || !PLUGIN_SLUG_RE.test(slug)) {
      errors.push(
        `plugin_slug: "${slug ?? ""}" is not a valid plugin slug (a-z0-9-, 3-64 chars)`
      )
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, manifest: parsed.data }
}

/** The registry slug an extension listing publishes under. */
export function resolvePluginSlug(input: {
  pluginSlug?: string | null
  listingSlug?: string | null
}): string | null {
  if (typeof input.pluginSlug === "string" && input.pluginSlug.length > 0) {
    return input.pluginSlug
  }
  if (typeof input.listingSlug === "string" && input.listingSlug.length > 0) {
    return input.listingSlug
  }
  return null
}

/**
 * Build the canonical DISTRIBUTION manifest — the exact object that gets
 * canonical-JSON hashed, signed, stored on `plugin_version.manifest`, and
 * served at `manifest_url`. Pure and deterministic (no Date/random): authored
 * fields + the server-injected listing ref + the bundle hash + a defaulted
 * protocol version.
 */
export function buildDistributionManifest(args: {
  authored: ExtensionManifest
  listingId: string
  publicSlug: string
  codeSha256?: string | null
}): ExtensionManifest {
  const sha256 = args.codeSha256 ?? args.authored.sha256
  return {
    ...args.authored,
    protocolVersion: args.authored.protocolVersion ?? 2,
    listing: {
      providerId: FBM_PROVIDER_ID,
      providerListingId: args.listingId,
      publicSlug: args.publicSlug,
    },
    ...(sha256 ? { sha256 } : {}),
  }
}

/**
 * Registry category for an artifact kind. `fbm.category` wins when set (the
 * only way to publish a third-party ANALYTICS plugin); `automation_recipe`
 * maps to AUTOMATION; everything else is a marketplace extension.
 */
export function mapArtifactKindToCategory(
  kind: ExtensionArtifactKind,
  fbmOverride?: PluginCategory | null
): PluginCategory {
  if (fbmOverride && Object.values(PluginCategory).includes(fbmOverride)) {
    return fbmOverride
  }
  if (kind === "automation_recipe") {
    return PluginCategory.AUTOMATION
  }
  return PluginCategory.MARKETPLACE_EXTENSION
}
