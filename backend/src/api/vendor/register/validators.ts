import { z } from "zod"
import { VendorType } from "../../../modules/seller-extension/models/seller-metadata"

/**
 * Vendor types available for sellers.
 *
 * Derived from the `VendorType` enum rather than restated, because the
 * hand-maintained copy this replaces had already drifted: it claimed to match
 * `VendorType` but was missing `creator`, so registrations selecting that
 * archetype were rejected at the API boundary even though both the TS enum and
 * the Postgres enum accepted it.
 */
export const vendorTypeEnum = z.enum(
  Object.values(VendorType) as [string, ...string[]]
)

/**
 * Playbook ids — the canonical vendor classification that replaces
 * vendor_type. Must match PLAYBOOK_IDS in the playbook module.
 */
export const playbookIdEnum = z.enum([
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
  "creator",
])

/**
 * Resource keys captured by the "what do you have?" registration quiz.
 * Must match ResourceKey in
 * vendor-panel/src/components/playbook/playbook-picker/recommend-from-resources.ts
 */
export const resourceKeyEnum = z.enum([
  "land",
  "time",
  "transportation",
  "materials_skills",
  "equipment",
  "audience",
  "network",
  "organization",
  "manufacturing",
  "marketing",
  "goods",
  "creativity",
  "capital",
])

/**
 * Create Seller Registration Request Schema
 *
 * Validates the request body for POST /vendor/register
 * Accepts core fields needed for seller registration request.
 * The request will be submitted for admin approval.
 * Once approved, the seller entity and metadata will be created.
 */
export const createSellerRegistrationSchema = z.object({
  // Core seller fields
  name: z.string().min(1, "Seller name is required"),

  // Vendor type selection (optional, defaults to "producer" if not provided).
  // Retained as a legacy read-cache; `playbook` below is the source of truth.
  vendor_type: vendorTypeEnum.optional(),

  // Playbook selected via the resource quiz, plus the full role set (the
  // quiz's override grid allows more than one), what the quiz recommended,
  // and the resources the user reported. Applied as a playbook_assignment
  // on approval; multi-role selections union each role's default feature
  // keys into seller_metadata.enabled_extensions. All optional for backward
  // compatibility with older clients.
  playbook: playbookIdEnum.optional(),
  roles: z.array(playbookIdEnum).optional(),
  recommended_playbook: playbookIdEnum.optional(),
  resources: z.array(resourceKeyEnum).optional(),

  // Member information
  member: z.object({
    name: z.string().min(1, "Member name is required"),
    email: z.string().email("Valid email is required"),
  }),
})

export type CreateSellerRegistrationInput = z.infer<typeof createSellerRegistrationSchema>
