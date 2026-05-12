/**
 * v0 asset-kind seed.
 *
 * Source of truth for the taxonomy nodes both v0 manifests
 * (yard-scrap-nursery, tool-library) require. Code is the source of
 * truth; the `asset_kind` table is seeded from this catalog at boot.
 *
 * The taxonomy is hierarchical. Slugs are dot-separated and a manifest
 * may match a non-leaf node with a trailing `.*` wildcard (e.g.
 * `tool.*` matches any tool subkind). Adding a new manifest typically
 * adds new leaves here and leaves the shape intact.
 *
 * `attribute_schema` is the zod schema a declaration's `attributes`
 * JSON must validate against. v0 keeps attribute schemas minimal — only
 * the fields the v0 manifests' constraints reference are modeled. v1
 * fills in more.
 */

import { z } from "zod"
import type {
  AssetCategoryT,
  LifecycleT,
  SensitivityTierT,
} from "../manifests/types"

export type AssetKindDefinition = {
  slug: string
  category: AssetCategoryT
  parent_slug: string | null
  display_name: string
  attribute_schema: z.ZodTypeAny
  default_sensitivity_tier: SensitivityTierT
  default_lifecycle: LifecycleT
}

const EmptyAttributes = z.object({}).strict()

export const ASSET_KIND_CATALOG: ReadonlyArray<AssetKindDefinition> = [
  // ── land / yard ───────────────────────────────────────────────────
  {
    slug: "land",
    category: "space",
    parent_slug: null,
    display_name: "Land",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "land.yard",
    category: "space",
    parent_slug: "land",
    display_name: "Yard",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "land.yard.residential",
    category: "space",
    parent_slug: "land.yard",
    display_name: "Residential yard",
    attribute_schema: z
      .object({
        acreage: z.number().positive(),
        soil_tested: z.boolean().optional(),
        water_access: z.boolean().optional(),
        sun_hours: z.number().min(0).max(24).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },

  // ── space / storage ───────────────────────────────────────────────
  {
    slug: "space",
    category: "space",
    parent_slug: null,
    display_name: "Space",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "space.storage",
    category: "space",
    parent_slug: "space",
    display_name: "Storage space",
    attribute_schema: z
      .object({
        square_feet: z.number().positive(),
        climate_controlled: z.boolean().optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "space.event-venue",
    category: "space",
    parent_slug: "space",
    display_name: "Event venue",
    attribute_schema: z
      .object({
        capacity: z.number().int().positive(),
        accessible: z.boolean().optional(),
        recurrence: z.string().optional(),
      })
      .strict(),
    default_sensitivity_tier: "public",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "space.home",
    category: "space",
    parent_slug: "space",
    display_name: "Home",
    attribute_schema: z
      .object({
        capacity: z.number().int().positive().optional(),
        accessible: z.boolean().optional(),
        childproofed: z.boolean().optional(),
        smoke_free: z.boolean().optional(),
      })
      .strict(),
    // Member-visible: a home address is the owner's, not public.
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },

  // ── tools ─────────────────────────────────────────────────────────
  {
    slug: "tool",
    category: "physical-artifact",
    parent_slug: null,
    display_name: "Tool",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "tool.hand-tool",
    category: "physical-artifact",
    parent_slug: "tool",
    display_name: "Hand tool",
    attribute_schema: z.object({ description: z.string() }).strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "exhaustible-borrow-return",
  },
  {
    slug: "tool.power-tool",
    category: "physical-artifact",
    parent_slug: "tool",
    display_name: "Power tool",
    attribute_schema: z
      .object({
        corded: z.boolean(),
        voltage: z.number().positive().optional(),
        brand: z.string().optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "exhaustible-borrow-return",
  },
  {
    slug: "tool.vehicle",
    category: "physical-artifact",
    parent_slug: "tool",
    display_name: "Vehicle",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "tool.vehicle.truck",
    category: "physical-artifact",
    parent_slug: "tool.vehicle",
    display_name: "Truck",
    attribute_schema: z
      .object({
        bed_length_ft: z.number().positive().optional(),
        payload_lbs: z.number().positive().optional(),
        has_hitch: z.boolean().optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "tool.garden",
    category: "physical-artifact",
    parent_slug: "tool",
    display_name: "Garden tool",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "exhaustible-borrow-return",
  },
  {
    slug: "tool.garden.tiller",
    category: "physical-artifact",
    parent_slug: "tool.garden",
    display_name: "Tiller",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "exhaustible-borrow-return",
  },
  {
    slug: "tool.garden.auger",
    category: "physical-artifact",
    parent_slug: "tool.garden",
    display_name: "Soil auger",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "exhaustible-borrow-return",
  },

  // ── skills ────────────────────────────────────────────────────────
  {
    slug: "skill",
    category: "skill",
    parent_slug: null,
    display_name: "Skill",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.horticulture",
    category: "skill",
    parent_slug: "skill",
    display_name: "Horticulture",
    attribute_schema: z
      .object({
        years_experience: z.number().nonnegative().optional(),
        specialties: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.installation",
    category: "skill",
    parent_slug: "skill",
    display_name: "Site installation",
    attribute_schema: z
      .object({
        years_experience: z.number().nonnegative().optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.repair",
    category: "skill",
    parent_slug: "skill",
    display_name: "Repair",
    attribute_schema: z
      .object({
        years_experience: z.number().nonnegative().optional(),
        tools_owned: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.repair.electronics",
    category: "skill",
    parent_slug: "skill.repair",
    display_name: "Electronics repair",
    attribute_schema: z
      .object({
        soldering: z.boolean().optional(),
        smd_capable: z.boolean().optional(),
        device_classes: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.repair.textile",
    category: "skill",
    parent_slug: "skill.repair",
    display_name: "Textile repair",
    attribute_schema: z
      .object({
        machine_available: z.boolean().optional(),
        techniques: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.repair.mechanical",
    category: "skill",
    parent_slug: "skill.repair",
    display_name: "Mechanical repair",
    attribute_schema: z
      .object({
        domains: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.childcare",
    category: "skill",
    parent_slug: "skill",
    display_name: "Childcare",
    attribute_schema: z
      .object({
        years_experience: z.number().nonnegative().optional(),
        ages_comfortable_with: z
          .array(
            z.enum(["infant", "toddler", "preschool", "school-age", "teen"])
          )
          .optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "skill.peer-support",
    category: "skill",
    parent_slug: "skill",
    display_name: "Peer support",
    // "Lived experience" support (per the cluster-3 sanity check).
    // The attribute schema is intentionally minimal in v0; the lived-
    // experience-attestation primitive that would govern who can vouch
    // for this skill is a post-v0 concern (HANDOFF item: governance v2).
    attribute_schema: z
      .object({
        domains: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },

  // ── time ──────────────────────────────────────────────────────────
  {
    slug: "time",
    category: "time",
    parent_slug: null,
    display_name: "Time",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "recurring",
  },
  {
    slug: "time.recurring",
    category: "time",
    parent_slug: "time",
    display_name: "Recurring time commitment",
    attribute_schema: z
      .object({
        hours_per_week: z.number().positive(),
        preferred_days: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "recurring",
  },
  {
    slug: "time.coordinator",
    category: "time",
    parent_slug: "time",
    display_name: "Coordinator time",
    attribute_schema: z
      .object({
        hours_per_week: z.number().positive(),
        response_sla_hours: z.number().positive().optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "recurring",
  },
  {
    slug: "time.event-shift",
    category: "time",
    parent_slug: "time",
    display_name: "Event-shift time",
    attribute_schema: z
      .object({
        hours: z.number().positive(),
        event_date: z.string().optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "perishable",
  },

  // ── output capacity ───────────────────────────────────────────────
  {
    slug: "output-capacity",
    category: "output-capacity",
    parent_slug: null,
    display_name: "Output capacity",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "perishable",
  },
  {
    slug: "output-capacity.yard-scrap",
    category: "output-capacity",
    parent_slug: "output-capacity",
    display_name: "Yard-scrap supply",
    attribute_schema: z
      .object({
        cubic_yards_per_month: z.number().positive(),
        kinds: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "recurring",
  },
  {
    slug: "output-capacity.compost",
    category: "output-capacity",
    parent_slug: "output-capacity",
    display_name: "Compost output",
    attribute_schema: z
      .object({
        cubic_yards_per_month: z.number().positive(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "recurring",
  },
  {
    slug: "output-capacity.vermicast",
    category: "output-capacity",
    parent_slug: "output-capacity",
    display_name: "Vermicast (worm casting) output",
    attribute_schema: z
      .object({
        lbs_per_month: z.number().positive(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "recurring",
  },
  {
    slug: "output-capacity.plant-plug",
    category: "output-capacity",
    parent_slug: "output-capacity",
    display_name: "Plant plug output",
    attribute_schema: z
      .object({
        plugs_per_month: z.number().positive(),
        species: z.array(z.string()).optional(),
      })
      .strict(),
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "recurring",
  },

  // ── artifacts (consumer-intake) ──────────────────────────────────
  {
    slug: "artifact",
    category: "physical-artifact",
    parent_slug: null,
    display_name: "Artifact",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "public",
    default_lifecycle: "one-time",
  },
  {
    slug: "artifact.broken-item",
    category: "physical-artifact",
    parent_slug: "artifact",
    display_name: "Broken item (intake)",
    attribute_schema: z
      .object({
        category: z.enum([
          "electronics",
          "textile",
          "mechanical",
          "appliance",
          "other",
        ]),
        symptom: z.string().min(1),
        not_water_damaged: z.boolean().optional(),
      })
      .strict(),
    default_sensitivity_tier: "public",
    default_lifecycle: "one-time",
  },

  // ── credentials ───────────────────────────────────────────────────
  {
    slug: "credential",
    category: "credential",
    parent_slug: null,
    display_name: "Credential",
    attribute_schema: EmptyAttributes,
    default_sensitivity_tier: "member-visible",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "credential.trust-score",
    category: "credential",
    parent_slug: "credential",
    display_name: "Member trust score",
    attribute_schema: z
      .object({
        score: z.number().min(0).max(100),
        loans_completed: z.number().int().nonnegative().optional(),
      })
      .strict(),
    default_sensitivity_tier: "match-only",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "credential.cpr-certified",
    category: "credential",
    parent_slug: "credential",
    display_name: "CPR certification",
    // The full W3C VC body lives on the linked Attestation row's
    // `external.vc_payload` (validated by attestations/vc.ts). The
    // declaration's attribute_schema captures only the extracted
    // fields used for matching (the credentialSubject claims).
    attribute_schema: z
      .object({
        levels: z
          .array(z.enum(["adult", "child", "infant"]))
          .min(1)
          .optional(),
        valid_until: z.string().datetime().optional(),
      })
      .strict(),
    default_sensitivity_tier: "match-only",
    default_lifecycle: "durable-commitment",
  },
  {
    slug: "credential.background-check",
    category: "credential",
    parent_slug: "credential",
    display_name: "Background check",
    // Subject's clearance status + scope. VC body lives on Attestation.
    // Revocation pull (BitstringStatusList) is a v1 follow-up; v0 trusts
    // the attestation's validity window.
    attribute_schema: z
      .object({
        cleared: z.boolean(),
        scope: z
          .array(z.string())
          .optional(),
        valid_until: z.string().datetime().optional(),
      })
      .strict(),
    default_sensitivity_tier: "match-only",
    default_lifecycle: "durable-commitment",
  },
] as const

const KIND_BY_SLUG: ReadonlyMap<string, AssetKindDefinition> = new Map(
  ASSET_KIND_CATALOG.map((k) => [k.slug, k])
)

export const getAssetKind = (slug: string): AssetKindDefinition => {
  const kind = KIND_BY_SLUG.get(slug)
  if (!kind) {
    throw new Error(`Unknown asset kind slug: ${slug}`)
  }
  return kind
}

/**
 * Whether a concrete declaration slug matches a manifest's required slug,
 * honoring a single trailing `.*` wildcard.
 *
 *   matchesKindSlug("tool.*", "tool.power-tool.drill") => true
 *   matchesKindSlug("tool.vehicle.truck", "tool.vehicle.truck") => true
 *   matchesKindSlug("tool.vehicle.truck", "tool.vehicle") => false
 */
export const matchesKindSlug = (
  required: string,
  declared: string
): boolean => {
  if (!required.endsWith(".*")) {
    return required === declared
  }
  const prefix = required.slice(0, -2)
  return declared === prefix || declared.startsWith(`${prefix}.`)
}
