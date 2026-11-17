import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import { PLAYBOOK_MODULE } from "../modules/playbook"
import { LISTING_TYPE_MODULE } from "../modules/listing-type"
import { LISTING_TYPE_CATALOG } from "../modules/listing-type/catalog"
import type { PlaybookId, ListingTypeId } from "../modules/playbook"
import { sellerIdForVendorActor } from "./seller-actor"

/**
 * Playbook × listing-type compatibility enforcement per
 * `docs/PLAYBOOK_SYSTEM.md`.
 *
 * This used to run as a `createProductsWorkflow.hooks.productsCreated`
 * hook, but Medusa v2 allows only one handler per hook and mercurjs
 * `@mercurjs/b2c-core` already registers `productsCreated` — the double
 * registration crashed app boot. Enforcement now lives at the vendor
 * product-create API layer (the cheaper, pre-commit path the original
 * hook comment already called "preferred"), wired as a route middleware
 * in `src/api/middlewares.ts`.
 *
 * A product's listing-type is supplied via `additional_data`:
 *   - `additional_data.listing_type_id` (preferred), or
 *   - `additional_data.fbm_listing_type` (back-compat alias).
 *
 * When the field is absent the product takes the seller's playbook's
 * `default_listing_type`. It used to take `physical_product` whatever the
 * playbook, and the vendor panel's product form sends no listing type, so
 * every product a Service vendor made there was refused (Service does not
 * allow physical products). When the seller has no playbook assignment
 * (e.g. legacy seller pre-picker), validation is skipped and an untyped
 * product is `physical_product` — the vendor-panel migration flow
 * re-prompts these sellers.
 */

/** The listing type a create request names, if it names one. */
export function requestedListingTypeId(
  additionalData?: Record<string, unknown> | null
): string | undefined {
  const additional = additionalData ?? {}
  return (
    (additional.listing_type_id as string | undefined) ??
    (additional.fbm_listing_type as string | undefined)
  )
}

/**
 * The listing type a create request names, or `fallback` when it names
 * none. Callers that know the seller pass the playbook's default
 * ({@link resolveAllowedListingType} does).
 */
export function resolveListingTypeId(
  additionalData?: Record<string, unknown> | null,
  fallback: ListingTypeId = "physical_product"
): ListingTypeId {
  return (requestedListingTypeId(additionalData) ?? fallback) as ListingTypeId
}

/**
 * Resolve the seller id behind a vendor request actor, by the rule both gates
 * use (shared/seller-actor.ts): a member id only while the member and its
 * store are live; a seller id only through the live member of that store at
 * the login's address, which the vendor gate has already checked when it
 * hands the store on as `_seller_id`. A removed member's id used to resolve to
 * the store it was removed from, or be passed on as if it were a seller id.
 */
export async function resolveSellerId(
  req: MedusaRequest,
  actorId?: string
): Promise<string | undefined> {
  return sellerIdForVendorActor(req, actorId)
}

/**
 * Throw `MedusaError(INVALID_DATA)` when `additionalData`'s listing-type is
 * not allowed on the seller's assigned playbook, or names an unknown
 * catalog id. No-ops when the seller is unknown or has no playbook
 * assignment (legacy sellers).
 */
export async function assertListingTypeAllowed(
  container: MedusaContainer,
  args: { sellerId?: string; additionalData?: Record<string, unknown> | null }
): Promise<void> {
  await resolveAllowedListingType(container, args)
}

/**
 * The listing type a product being created takes: the one the request
 * names, or the seller's playbook's default when it names none (and
 * `physical_product` for a seller with no playbook, or none known). Throws
 * `MedusaError(INVALID_DATA)` like {@link assertListingTypeAllowed} when the
 * playbook does not allow it or the catalog does not know it.
 */
export async function resolveAllowedListingType(
  container: MedusaContainer,
  args: { sellerId?: string; additionalData?: Record<string, unknown> | null }
): Promise<ListingTypeId> {
  const { sellerId } = args
  if (!sellerId) {
    return resolveListingTypeId(args.additionalData)
  }

  const playbookService: any = container.resolve(PLAYBOOK_MODULE)
  const listingTypeService: any = container.resolve(LISTING_TYPE_MODULE)

  const [assignment] = await playbookService.listPlaybookAssignments({
    seller_id: sellerId,
  })
  if (!assignment) {
    // Legacy seller — skip; vendor-panel migration flow re-prompts.
    return resolveListingTypeId(args.additionalData)
  }

  const recipeId = assignment.recipe_id as PlaybookId
  const listingTypeId = resolveListingTypeId(
    args.additionalData,
    playbookService.getRecipe(recipeId).default_listing_type
  )
  if (!playbookService.isListingTypeAllowed(recipeId, listingTypeId)) {
    const recipe = playbookService.getRecipe(recipeId)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Listing type "${listingTypeId}" is not allowed on the ${recipe.display_name} playbook. ` +
        `Allowed types: ${(recipe.allowed_listing_types as string[]).join(", ")}. ` +
        `Switch playbooks (vendor settings → playbook) if your offering shape no longer fits.`
    )
  }

  // Surface a friendly error for an unknown catalog id, in case
  // malformed `additional_data` slipped past the form.
  try {
    listingTypeService.getDefinition(listingTypeId)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown listing-type "${listingTypeId}". Pick one from the v1 catalog (see docs/LISTING_TYPES.md).`
    )
  }
  return listingTypeId
}

/**
 * Enforce the one-of-a-kind (`unique_inventory`) rule: such a listing is locked
 * to a single unit (`docs/LISTING_TYPES.md`; catalog flag `unique_inventory`).
 * Reject a product-create payload that stocks more than one of a managed variant.
 *
 * Deliberately defensive — it only fires when a variant *explicitly* declares
 * `inventory_quantity > 1`, so it never false-rejects payloads that omit stock
 * (those are governed by inventory-level enforcement) or products of other types.
 * Pure (reads the static catalog), so it needs no container.
 */
export function assertUniqueInventoryConstraints(
  listingTypeId: ListingTypeId,
  productData?: Record<string, unknown> | null
): void {
  const definition = LISTING_TYPE_CATALOG[listingTypeId]
  if (!definition?.unique_inventory) {
    return
  }

  const variants = Array.isArray((productData as any)?.variants)
    ? ((productData as any).variants as Array<Record<string, unknown>>)
    : []

  for (const variant of variants) {
    // `manage_inventory` defaults to true in Medusa; only unmanaged variants opt out.
    const managed = variant.manage_inventory !== false
    const quantity = variant.inventory_quantity
    if (managed && typeof quantity === "number" && quantity > 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `One-of-a-kind listings ("${definition.display_name}") are limited to a single ` +
          `unit; a variant declared inventory_quantity=${quantity}. Set it to 1, or list ` +
          `each item as its own listing.`
      )
    }
  }
}

/**
 * Route middleware for the vendor product-create endpoints. Resolves the
 * authenticated seller (not the client-supplied `additional_data.seller_id`)
 * and rejects incompatible playbook × listing-type combinations — and, for
 * one-of-a-kind types, an over-one stock quantity — before the product workflow
 * runs.
 */
export async function enforceListingTypeAllowed(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  try {
    const actorId =
      (req as any)._seller_id || (req as any).auth_context?.actor_id
    const sellerId = await resolveSellerId(req, actorId)
    const { additional_data, ...productData } = (req.body as any) ?? {}

    const listingTypeId = await resolveAllowedListingType(req.scope, {
      sellerId,
      additionalData: additional_data,
    })

    // Data-integrity rule, independent of the seller's playbook: enforced for
    // every seller (including legacy sellers the playbook check skips).
    assertUniqueInventoryConstraints(listingTypeId, productData)

    next()
  } catch (error) {
    next(error as Error)
  }
}
