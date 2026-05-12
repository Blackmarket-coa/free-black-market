/**
 * Settlement emission.
 *
 * When a project instance executes a transaction (a tool-library
 * loan returns, a household drops yard scrap, a repair completes,
 * a nursery sells a plant flat), the asset-graph emits a
 * `SettlementRecord` that scopes the flow to its manifest + project
 * instance and identifies the rail and counterparties.
 *
 * v0.1 ships this side of the wire: compose the settlement intent
 * (validate the rail against the manifest, enforce per-rail required
 * fields), and persist a SettlementRecord row with
 * `ledger_entry_id: null` — the "unsettled" marker.
 *
 * A reconciler workflow (v0.2) reads unsettled records and calls
 * hawala-ledger to write the matching `ledger_entry` (or
 * `karma_event` for the KARMA rail; or nothing for GIFT which is
 * audit-only). When the ledger write completes, the workflow updates
 * the SettlementRecord with `ledger_entry_id`. That separation keeps
 * asset-graph free of hawala-ledger internals — the cross-module
 * layering this codebase already uses (workflows do the stitching,
 * not the modules themselves).
 *
 * Per-rail required fields, enforced at compose time:
 *
 *   CCR   purchase context: order_id, cart_id, or a
 *         reference_type ∈ PURCHASE_CONTEXT_REFERENCE_TYPES with
 *         non-empty reference_id.
 *
 *   HRS   time-bank reference: reference_type ∈ {TIMEBANK_LOAN,
 *         TIMEBANK_RETURN, TIMEBANK_REDISTRIBUTION,
 *         TIMEBANK_OPEN_BALANCE} with non-empty reference_id; debit
 *         and credit accounts (from/to members) must differ.
 *
 *   KARMA reason slug (string). KARMA is unilateral — by convention
 *         from_member_id can be "SYSTEM" for system-granted karma or
 *         the counterparty that triggered the accrual (e.g. the
 *         customer whose item was repaired); to_member_id is the
 *         karma recipient.
 *
 *   USDC  amount + asset_code; cash-rail path otherwise minimal.
 *   USD   same as USDC.
 *
 *   GIFT  audit-only; no required reference. amount_minor may be 0
 *         (the canonical "non-settling" flow) but isn't required to
 *         be.
 *
 * The `from_member_id` / `to_member_id` columns on SettlementRecord
 * are bilateral by schema; for KARMA we interpret them as
 * source-of-accrual and recipient.
 */

import type { ProjectManifestRecipe, SettlementRailT } from "./manifests/types"
import {
  RAIL_CODE_BY_MANIFEST_RAIL,
  type RailCode,
} from "../hawala-ledger/rails"
import {
  PURCHASE_CONTEXT_REFERENCE_TYPES,
  TIMEBANK_REFERENCE_TYPES,
} from "../hawala-ledger/posture-a-guard"

/**
 * Caller-facing intent. The rail is named in the manifest's
 * vocabulary (lowercase: 'ccr', 'usdc', 'hours', 'karma', 'gift').
 * compose translates to the ledger's uppercase `RailCode` internally.
 */
export type SettlementIntent = {
  project_instance_id: string
  /** The manifest the project instance deploys — used for rail-allowed validation. */
  manifest: ProjectManifestRecipe
  rail: SettlementRailT
  amount_minor: number
  asset_code: string
  from_member_id: string
  to_member_id: string
  occurred_at: Date

  // Per-rail metadata. Required-or-not depends on rail; compose
  // checks the right ones.
  reference_type?: string
  reference_id?: string
  order_id?: string
  cart_id?: string
  /** KARMA only — short reason slug (e.g. `repair-completed`). */
  karma_reason?: string
  /** KARMA only — module + id of the source artifact (e.g. project_instance + id). */
  karma_source?: { module: string; id: string }

  /**
   * Optional dedup key. When set and the service's
   * emitSettlementRecord finds an existing record with the same key,
   * it returns the existing row instead of writing a duplicate.
   * Convention for systematic emitters:
   * `${manifest_slug}-${source_event_id}`.
   */
  idempotency_key?: string

  metadata?: Record<string, unknown>
}

export class SettlementValidationError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) {
    super(message)
    this.name = "SettlementValidationError"
  }
}

/**
 * Top-level rail vocabulary check: the intent's rail must appear in
 * the manifest's `settlement_rails`. A nursery instance can't accrue
 * HRS because the nursery manifest doesn't declare the hours rail.
 */
export const assertRailAllowedForManifest = (
  rail: SettlementRailT,
  manifest: ProjectManifestRecipe
): void => {
  if (!manifest.settlement_rails.includes(rail)) {
    throw new SettlementValidationError(
      `Rail '${rail}' is not allowed by manifest '${manifest.slug}'. ` +
        `Allowed: ${manifest.settlement_rails.join(", ")}.`,
      {
        rail,
        manifest_slug: manifest.slug,
        allowed_rails: manifest.settlement_rails,
      }
    )
  }
}

/**
 * Per-rail required-field validation. Pure; throws
 * `SettlementValidationError` on the first issue. Order matters: the
 * thrown error names the specific rule that failed.
 */
export const assertRailRequiredFields = (intent: SettlementIntent): void => {
  const code: RailCode = RAIL_CODE_BY_MANIFEST_RAIL(intent.rail)

  switch (code) {
    case "CCR": {
      const refMatches =
        intent.reference_type &&
        PURCHASE_CONTEXT_REFERENCE_TYPES.has(intent.reference_type) &&
        (intent.reference_id ?? "").length > 0
      if (!intent.order_id && !intent.cart_id && !refMatches) {
        throw new SettlementValidationError(
          "CCR settlement requires a goods/services purchase context " +
            "(order_id, cart_id, or a recognized reference_type + reference_id).",
          {
            rail: intent.rail,
            order_id: intent.order_id ?? null,
            cart_id: intent.cart_id ?? null,
            reference_type: intent.reference_type ?? null,
            reference_id: intent.reference_id ?? null,
          }
        )
      }
      return
    }

    case "HRS": {
      const ref = intent.reference_type ?? ""
      const refId = intent.reference_id ?? ""
      if (!TIMEBANK_REFERENCE_TYPES.has(ref) || refId.length === 0) {
        throw new SettlementValidationError(
          "HRS settlement requires a time-bank reference_type + reference_id " +
            "(reference_type ∈ " +
            [...TIMEBANK_REFERENCE_TYPES].join(", ") +
            ").",
          {
            rail: intent.rail,
            reference_type: intent.reference_type ?? null,
            reference_id: intent.reference_id ?? null,
          }
        )
      }
      if (intent.from_member_id === intent.to_member_id) {
        throw new SettlementValidationError(
          "HRS settlement rejected: from_member_id and to_member_id are the same. " +
            "Hours record work done for someone else; a self-transfer has no time-bank meaning.",
          {
            from_member_id: intent.from_member_id,
            to_member_id: intent.to_member_id,
          }
        )
      }
      return
    }

    case "KARMA": {
      if (!intent.karma_reason || intent.karma_reason.length === 0) {
        throw new SettlementValidationError(
          "KARMA settlement requires a karma_reason slug " +
            "(e.g. 'repair-completed', 'tool-loan-returned').",
          { rail: intent.rail }
        )
      }
      return
    }

    case "USD":
    case "USDC": {
      if (intent.amount_minor <= 0) {
        throw new SettlementValidationError(
          `${code} settlement requires a positive amount_minor.`,
          { rail: intent.rail, amount_minor: intent.amount_minor }
        )
      }
      return
    }

    case "GIFT": {
      // Audit-only. No required fields beyond the common ones.
      return
    }
  }
}

/**
 * Persistable shape that maps onto the SettlementRecord model. Note
 * `ledger_entry_id` is null in v0.1 — the reconciler workflow stamps
 * it once it writes the corresponding hawala-ledger entry (or karma
 * event, for KARMA; or nothing, for GIFT, in which case the record
 * stays with `ledger_entry_id: null` permanently).
 */
export type SettlementRecordPayload = {
  manifest_slug: string
  project_instance_id: string | null
  ledger_entry_id: null
  rail: SettlementRailT
  from_member_id: string
  to_member_id: string
  amount_minor: number
  asset_code: string
  occurred_at: Date
  idempotency_key: string | null
  metadata: Record<string, unknown>
}

/**
 * Compose a SettlementRecord payload from an intent. Performs both
 * rail-allowed validation (against the manifest) and per-rail
 * required-field validation. Returns the payload ready for the
 * service to persist; the caller is responsible for catching
 * `SettlementValidationError` and surfacing it.
 *
 * Compose does not write. The asset-graph service's
 * `emitSettlementRecord` is the thin wrapper that calls this and
 * persists the result.
 */
export const composeSettlement = (
  intent: SettlementIntent
): SettlementRecordPayload => {
  assertRailAllowedForManifest(intent.rail, intent.manifest)
  assertRailRequiredFields(intent)

  // Carry the rail-specific reference metadata into the record's
  // metadata column so a reconciler workflow has everything it needs
  // to mint the corresponding hawala-ledger entry / karma_event
  // without re-reading the intent.
  const metadata: Record<string, unknown> = {
    ...(intent.metadata ?? {}),
  }
  if (intent.reference_type) metadata.reference_type = intent.reference_type
  if (intent.reference_id) metadata.reference_id = intent.reference_id
  if (intent.order_id) metadata.order_id = intent.order_id
  if (intent.cart_id) metadata.cart_id = intent.cart_id
  if (intent.karma_reason) metadata.karma_reason = intent.karma_reason
  if (intent.karma_source) {
    metadata.karma_source_module = intent.karma_source.module
    metadata.karma_source_id = intent.karma_source.id
  }

  return {
    manifest_slug: intent.manifest.slug,
    project_instance_id: intent.project_instance_id,
    ledger_entry_id: null,
    rail: intent.rail,
    from_member_id: intent.from_member_id,
    to_member_id: intent.to_member_id,
    amount_minor: intent.amount_minor,
    asset_code: intent.asset_code,
    occurred_at: intent.occurred_at,
    idempotency_key: intent.idempotency_key ?? null,
    metadata,
  }
}
