import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/playbook/assign")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../../shared"
import {
  assignPlaybookWorkflow,
  type AssignPlaybookInput,
} from "../../../../workflows/assign-playbook"
import {
  PLAYBOOK_MODULE,
  PLAYBOOK_IDS,
  unionFeatureKeys,
  type PlaybookId,
} from "../../../../modules/playbook"
import type PlaybookService from "../../../../modules/playbook/service"
import type SellerExtensionService from "../../../../modules/seller-extension/service"
import { SELLER_EXTENSION_MODULE } from "../../../../modules/seller-extension"
import { updateSellerMetadataRecord } from "../../../../modules/seller-extension/metadata-service"
import {
  defaultFeatureKeysForPlaybook,
  pluginSlugsFrom,
} from "../../../../shared/extension-keys"
import { preflightPlaybookSwitch } from "../../../../shared/playbook-preflight"
import type { PlaybookPreflight } from "../../../../shared/playbook-preflight"

type PostBody = {
  recipe_id?: string
  answers?: AssignPlaybookInput["answers"]
  recommended_recipe_id?: string
  overridden?: boolean
  /** All roles the seller selected (primary is `recipe_id`). */
  roles?: string[]
  /** Resources reported in the quiz. */
  resources?: string[]
  /**
   * Optional free text for why the vendor is changing playbooks. Recorded on
   * the transition; never required, and never inferred when absent.
   */
  reason?: string
}

/** Cap on the stored `reason` so a stray paste can't bloat the history table. */
const MAX_REASON_LENGTH = 2000

const RESOURCE_KEYS = new Set([
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
])

const SIZE_VALUES = new Set(["solo", "small", "medium", "federation"])
const GOVERNANCE_VALUES = new Set([
  "i_decide",
  "informal_agreement",
  "circles",
  "elected_reps",
  "federation_council",
])
const OFFERING_VALUES = new Set([
  "make_or_grow",
  "services",
  "subscription_or_season",
  "kitchen_food",
  "harvest_pool",
  "aggregator",
])

function isPlaybookId(value: unknown): value is PlaybookId {
  return typeof value === "string" && (PLAYBOOK_IDS as string[]).includes(value)
}

function validateAnswers(answers: unknown): {
  ok: true
  value: AssignPlaybookInput["answers"]
} | { ok: false; message: string } {
  if (answers === undefined || answers === null) {
    return { ok: true, value: undefined }
  }
  if (typeof answers !== "object") {
    return { ok: false, message: "answers must be an object" }
  }
  const a = answers as Record<string, unknown>
  if (!SIZE_VALUES.has(String(a.size))) {
    return { ok: false, message: `Invalid answers.size: ${String(a.size)}` }
  }
  if (!GOVERNANCE_VALUES.has(String(a.governance))) {
    return { ok: false, message: `Invalid answers.governance: ${String(a.governance)}` }
  }
  if (!OFFERING_VALUES.has(String(a.offering))) {
    return { ok: false, message: `Invalid answers.offering: ${String(a.offering)}` }
  }
  return {
    ok: true,
    value: {
      size: a.size,
      governance: a.governance,
      offering: a.offering,
    } as AssignPlaybookInput["answers"],
  }
}

/**
 * GET /vendor/playbook/assign
 *
 * Returns the authenticated seller's current playbook assignment, or
 * `null` when none exists. Used by the onboarding gate and the
 * dashboard banner to decide whether to surface the picker.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  try {
    const playbookService = req.scope.resolve<PlaybookService>(PLAYBOOK_MODULE)
    const [assignment] = await playbookService.listPlaybookAssignments({
      seller_id: sellerId,
    })
    return res.json({ playbook_assignment: assignment ?? null })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/playbook/assign] Error:", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to fetch playbook assignment",
    })
  }
}

/**
 * POST /vendor/playbook/assign
 *
 * Upserts the seller's playbook assignment via `assignPlaybookWorkflow`.
 * The workflow is idempotent (unique on `seller_id`); re-posting with a
 * different `recipe_id` updates the existing row in place.
 *
 * Body:
 *   - recipe_id (required): one of the ten PlaybookIds
 *   - answers (optional): { size, governance, offering }
 *   - recommended_recipe_id (optional): what the picker showed
 *   - overridden (optional): true when the user picked a non-recommended
 *     recipe; ignored if `recommended_recipe_id` differs from `recipe_id`
 *     (the workflow derives it).
 */
export async function POST(
  req: AuthenticatedMedusaRequest<PostBody>,
  res: MedusaResponse
) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const body = (req.body ?? {}) as PostBody

  if (!isPlaybookId(body.recipe_id)) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Invalid recipe_id: ${String(body.recipe_id)}. Must be one of ${PLAYBOOK_IDS.join(", ")}`,
    })
  }

  if (
    body.recommended_recipe_id !== undefined &&
    body.recommended_recipe_id !== null &&
    !isPlaybookId(body.recommended_recipe_id)
  ) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Invalid recommended_recipe_id: ${String(body.recommended_recipe_id)}`,
    })
  }

  const answersResult = validateAnswers(body.answers)
  if (!answersResult.ok) {
    return res.status(400).json({
      type: "invalid_data",
      message: answersResult.message,
    })
  }

  // Optional multi-role + resource payload (sent by the resource quiz). The
  // primary playbook is always `recipe_id`; `roles` is the full set.
  let roles: PlaybookId[] | undefined
  if (body.roles !== undefined) {
    if (!Array.isArray(body.roles) || !body.roles.every(isPlaybookId)) {
      return res.status(400).json({
        type: "invalid_data",
        message: `roles must be an array of valid playbook ids (${PLAYBOOK_IDS.join(", ")})`,
      })
    }
    roles = Array.from(
      new Set<PlaybookId>([body.recipe_id, ...(body.roles as PlaybookId[])])
    )
  }

  let resources: string[] | undefined
  if (body.resources !== undefined) {
    if (
      !Array.isArray(body.resources) ||
      !body.resources.every((r) => typeof r === "string" && RESOURCE_KEYS.has(r))
    ) {
      return res.status(400).json({
        type: "invalid_data",
        message: "resources must be an array of valid resource keys",
      })
    }
    resources = body.resources
  }

  let reason: string | undefined
  if (body.reason !== undefined && body.reason !== null) {
    if (typeof body.reason !== "string") {
      return res.status(400).json({
        type: "invalid_data",
        message: "reason must be a string",
      })
    }
    const trimmed = body.reason.trim()
    reason = trimmed.length ? trimmed.slice(0, MAX_REASON_LENGTH) : undefined
  }

  try {
    // Record what the vendor was shown about listings that won't fit the target
    // playbook. Advisory only — a non-empty result never blocks the switch, and
    // existing products keep working either way (enforcement is on write).
    //
    // Wholly best-effort: refusing to change someone's playbook because we
    // couldn't count their listings would be absurd, so any failure here
    // degrades to "not checked" and the assignment proceeds.
    let preflight: PlaybookPreflight | null = null
    try {
      const playbookService = req.scope.resolve<PlaybookService>(PLAYBOOK_MODULE)
      const [current] = await playbookService.listPlaybookAssignments({
        seller_id: sellerId,
      })
      if (current && current.recipe_id !== body.recipe_id) {
        preflight = await preflightPlaybookSwitch(req.scope, {
          sellerId,
          to: body.recipe_id,
        })
      }
    } catch (preflightError: unknown) {
      const message =
        preflightError instanceof Error ? preflightError.message : "unknown"
      log.warn(`[POST /vendor/playbook/assign] preflight skipped: ${message}`)
    }

    const input: AssignPlaybookInput = {
      seller_id: sellerId,
      recipe_id: body.recipe_id,
      answers: answersResult.value,
      recommended_recipe_id: isPlaybookId(body.recommended_recipe_id)
        ? body.recommended_recipe_id
        : undefined,
      // `migrated_from` is server-controlled (set by backfill script);
      // ignore any client-supplied value here.
      migrated_from: null,
      reason: reason ?? null,
      // Only meaningful when the check actually ran; an unchecked preflight
      // stores 0 but the response says `checked: false` so nobody reads the
      // zero as reassurance.
      stranded_listing_count: preflight?.checked
        ? preflight.stranded_listing_count
        : 0,
    }

    // Persist the role set + resources on the assignment (no schema change —
    // playbook_assignment.metadata is JSON).
    if (roles || resources) {
      input.metadata = {
        ...(roles ? { roles } : {}),
        ...(resources ? { resources } : {}),
      }
    }

    const { result } = await assignPlaybookWorkflow(req.scope).run({ input })

    // Keep the seller's feature override in sync with the chosen roles:
    // multi-role → union of all roles' default features; single role → clear
    // the override so the primary playbook's defaults apply. Non-blocking.
    //
    // Installed plugin slugs live in the same column and are NOT ours to
    // discard, so they are carried across every branch. When a single role
    // would otherwise clear the override to `null` but plugins are present,
    // the playbook's defaults are materialised instead — `null` would drop the
    // slugs, and a slug-only array would read as "every feature off".
    if (roles) {
      try {
        const sellerExtensionService = req.scope.resolve<SellerExtensionService>(SELLER_EXTENSION_MODULE)
        const [meta] = await sellerExtensionService.listSellerMetadatas({
          seller_id: sellerId,
        })
        if (meta) {
          const preserved = pluginSlugsFrom(meta.enabled_extensions)
          const nextExtensions =
            roles.length > 1
              ? [...unionFeatureKeys(roles), ...preserved]
              : preserved.length
                ? [...defaultFeatureKeysForPlaybook(roles[0]), ...preserved]
                : null

          await updateSellerMetadataRecord(sellerExtensionService, {
            id: meta.id,
            enabled_extensions: nextExtensions,
          })
        }
      } catch (syncError: unknown) {
        const message = syncError instanceof Error ? syncError.message : "unknown"
        log.warn(`[POST /vendor/playbook/assign] enabled_extensions sync failed: ${message}`)
      }
    }

    return res.json({
      playbook_assignment: result.playbook_assignment,
      /** Null on a first assignment or when the recipe did not change. */
      transition: (result as { transition?: unknown }).transition ?? null,
      preflight,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[POST /vendor/playbook/assign] Error:", message)
    return res.status(500).json({
      type: "server_error",
      message: `Failed to assign playbook: ${message}`,
    })
  }
}
