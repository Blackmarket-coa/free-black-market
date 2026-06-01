import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"

import { PLAYBOOK_MODULE } from "../modules/playbook"
import { LISTING_TYPE_MODULE } from "../modules/listing-type"
import type { PlaybookId, ListingTypeId } from "../modules/playbook"

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
 * When the field is absent the product defaults to `physical_product`
 * (the universal default). When the seller has no playbook assignment
 * (e.g. legacy seller pre-picker), validation is skipped — the vendor-
 * panel migration flow re-prompts these sellers.
 */

export function resolveListingTypeId(
  additionalData?: Record<string, unknown> | null
): ListingTypeId {
  const additional = additionalData ?? {}
  const raw =
    (additional.listing_type_id as string | undefined) ??
    (additional.fbm_listing_type as string | undefined)
  return (raw ?? "physical_product") as ListingTypeId
}

/**
 * Resolve the seller id behind a vendor request actor. A `mem_` actor is
 * a team member whose owning seller is looked up in the `member` table;
 * any other id is already a seller id.
 */
export async function resolveSellerId(
  req: MedusaRequest,
  actorId?: string
): Promise<string | undefined> {
  if (!actorId) {
    return undefined
  }

  if (!actorId.startsWith("mem_")) {
    return actorId
  }

  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const memberResult = await pgConnection.raw(
      `SELECT seller_id FROM member WHERE id = ? LIMIT 1`,
      [actorId]
    )

    return memberResult.rows?.[0]?.seller_id || actorId
  } catch {
    return actorId
  }
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
  const { sellerId } = args
  if (!sellerId) {
    return
  }

  const listingTypeId = resolveListingTypeId(args.additionalData)

  const playbookService: any = container.resolve(PLAYBOOK_MODULE)
  const listingTypeService: any = container.resolve(LISTING_TYPE_MODULE)

  const [assignment] = await playbookService.listPlaybookAssignments({
    seller_id: sellerId,
  })
  if (!assignment) {
    // Legacy seller — skip; vendor-panel migration flow re-prompts.
    return
  }

  const recipeId = assignment.recipe_id as PlaybookId
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
}

/**
 * Route middleware for the vendor product-create endpoints. Resolves the
 * authenticated seller (not the client-supplied `additional_data.seller_id`)
 * and rejects incompatible playbook × listing-type combinations before the
 * product workflow runs.
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
    const { additional_data } = (req.body as any) ?? {}

    await assertListingTypeAllowed(req.scope, {
      sellerId,
      additionalData: additional_data,
    })

    next()
  } catch (error) {
    next(error as Error)
  }
}
