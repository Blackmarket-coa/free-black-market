/**
 * Project manifest types + zod schemas.
 *
 * A project manifest is a declarative recipe for a vertical (yard-scrap
 * nursery, tool library, childcare co-op, ...). It says:
 *
 *   - what asset kinds the project needs from declaring members,
 *   - what settlement rails it uses (CCR, USDC, hours, karma, gift),
 *   - which playbook recipe it composes onto,
 *   - which listing-types it exposes,
 *   - what governance model applies,
 *   - what sensitivity floor declarations made under it must respect,
 *   - which surface (commerce, refrain, threshold, blackstar) it lives on.
 *
 * The manifest catalog is TypeScript-first (source of truth) and seeded
 * into the `project_manifest` table at boot for query convenience — same
 * pattern as `playbook` recipes and `listing-type` catalog.
 *
 * Zod is the runtime validator: every catalog entry is parsed at boot
 * via `ProjectManifestSchema.parse(...)` and a manifest with an escape
 * hatch (e.g. an unrecognized settlement rail) refuses to load.
 *
 * See `docs/ASSET_GRAPH.md`.
 */

import { z } from "zod"
import type { PlaybookId } from "../../playbook/recipes/types"
import type { ListingTypeId } from "../../listing-type/catalog/types"

/**
 * Top-level asset category. Mirrors `AssetKind.category` on the DB model.
 * The eight values come from the original asset-graph dimensions.
 */
export const AssetCategory = z.enum([
  "physical-artifact",
  "space",
  "skill",
  "time",
  "capital",
  "credential",
  "network-reach",
  "output-capacity",
])
export type AssetCategoryT = z.infer<typeof AssetCategory>

/**
 * Sensitivity tier on an asset declaration.
 *
 * v0 stores the tier; cryptographic enforcement (room-scoped,
 * match-only) is deferred. A manifest's `sensitivity_floor` is the
 * minimum tier declarations made under it must respect.
 */
export const SensitivityTier = z.enum([
  "public",
  "member-visible",
  "room-scoped",
  "match-only",
])
export type SensitivityTierT = z.infer<typeof SensitivityTier>

/**
 * Lifecycle of an asset declaration. Tells the matching engine and
 * settlement layer how to reason about persistence and exhaustion.
 */
export const Lifecycle = z.enum([
  "one-time",
  "recurring",
  "durable-commitment",
  "perishable",
  "exhaustible-borrow-return",
])
export type LifecycleT = z.infer<typeof Lifecycle>

/**
 * Governance model that applies to a manifest or declaration. Mirrors
 * the playbook `member_model` axis but is asset-graph-side so a manifest
 * can override.
 */
export const GovernanceModel = z.enum([
  "individual",
  "collective",
  "vote-weighted",
  "consensus",
])
export type GovernanceModelT = z.infer<typeof GovernanceModel>

/**
 * Settlement rails the asset graph composes. CCR and USDC route through
 * `hawala-ledger` directly; hours and karma extend the ledger (hours
 * deferred to a follow-up plan); gift is non-settling.
 *
 * The fiat USD rail exists for the Stripe ACH edge that hawala-ledger
 * already settles to.
 */
export const SettlementRail = z.enum([
  "ccr",
  "usdc",
  "usd",
  "karma",
  "hours",
  "gift",
])
export type SettlementRailT = z.infer<typeof SettlementRail>

/**
 * Composition surface (per `docs/COMPOSITION_LAYER.md`).
 *   - commerce: FBM proper (vendor storefront, retail).
 *   - refrain: creator-bounty surface.
 *   - threshold: mutual aid, free stores, tool libraries.
 *   - blackstar: delivery / mobility.
 */
export const Surface = z.enum([
  "commerce",
  "refrain",
  "threshold",
  "blackstar",
])
export type SurfaceT = z.infer<typeof Surface>

/** Roles an asset declaration can play inside a manifest. */
export const ManifestRole = z.enum([
  "host",
  "operator",
  "operator-or-shared",
  "operator-produced",
  "lender",
  "borrower-side",
  "library-node",
  "librarian",
  "coordinator",
  "member",
  "contributor",
  "fixer",
  "client",
  "caregiver",
])
export type ManifestRoleT = z.infer<typeof ManifestRole>

/**
 * Per-manifest constraint placed on an asset declaration. Numeric and
 * boolean constraints are validated at match time against
 * `AssetDeclaration.attributes`. The kind_slug supports a single
 * trailing wildcard segment (`tool.*`) so a manifest can require "any
 * tool" without enumerating every leaf.
 */
const KindSlug = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+|\.\*)*$/, {
    message:
      "kind slug must be dot-separated lowercase identifiers; a trailing '.*' wildcard is allowed",
  })

export const RequiredAssetKind = z.object({
  /** Dot-separated taxonomy slug; `tool.*` to match any subkind of tool. */
  kind_slug: KindSlug,
  role: ManifestRole,
  min_count: z.number().int().nonnegative().default(1),
  optional: z.boolean().default(false),
  /**
   * Free-form constraints validated against `AssetDeclaration.attributes`
   * at match time. Keys are kind-specific; values are JSON.
   */
  constraints: z.record(z.string(), z.unknown()).optional(),
  /** If set, only declarations with this lifecycle satisfy the slot. */
  lifecycle: Lifecycle.optional(),
})
export type RequiredAssetKindT = z.infer<typeof RequiredAssetKind>

/** Reference into the existing playbook recipe registry. */
const PlaybookSlug = z.enum([
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
]) satisfies z.ZodType<PlaybookId>

/** Reference into the existing listing-type catalog. */
const ListingTypeSlug = z.enum([
  "physical_product",
  "event",
  "digital",
  "recurring",
  "wholesale",
  "consignment",
  "unique_inventory",
  "bookable",
  "campaign",
]) satisfies z.ZodType<ListingTypeId>

export const ProjectManifestSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, {
      message: "manifest slug must be lowercase-kebab",
    }),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, {
    message: "version must be semver (e.g. 0.1.0)",
  }),
  display_name: z.string().min(1),
  description: z.string().min(1),
  required_asset_kinds: z.array(RequiredAssetKind).min(1),
  settlement_rails: z.array(SettlementRail).min(1),
  playbook_slug: PlaybookSlug,
  listing_type_slugs: z.array(ListingTypeSlug).min(1),
  governance_model: GovernanceModel,
  sensitivity_floor: SensitivityTier,
  surface: Surface,
})

/**
 * Runtime type for a manifest recipe (the catalog entry shape).
 * Suffixed `Recipe` for parallelism with `PlaybookRecipe`; the bare
 * name `ProjectManifest` belongs to the DB model in `./models/`.
 */
export type ProjectManifestRecipe = z.infer<typeof ProjectManifestSchema>
