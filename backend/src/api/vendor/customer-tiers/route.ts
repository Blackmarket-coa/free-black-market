import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createLogger } from "../../../shared/logger"
import { VENDOR_RULES_MODULE } from "../../../modules/vendor-rules"
import type VendorRulesService from "../../../modules/vendor-rules/service"
import { CustomerTierType } from "../../../modules/vendor-rules/models/vendor-customer-tier"
import {
  MAX_TERMS_DAYS,
  InvalidTermsError,
} from "../../../modules/accounts-receivable/terms"

const log = createLogger("api/vendor/customer-tiers")

const getSellerId = (req: MedusaRequest) =>
  (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id

/**
 * The fields a vendor may set on a tier, validated once for POST and PATCH.
 *
 * `payment_terms_days` and `credit_limit_cents` are the two that
 * accounts-receivable reads. Until this route existed neither had a writer:
 * terms only ever came from the wholesale seed's hardcoded 30, and the credit
 * ceiling — added in 502d336 — could not be set by anyone, so every buyer
 * resolved to "no limit" and the whole credit-check apparatus had nothing to
 * check. A vendor who wanted "Net-30 up to $5,000" had no way to say so.
 *
 * `credit_limit_cents` accepts null explicitly: null is "this vendor runs no
 * limit", 0 is "this buyer may not carry a balance", and both are real
 * settings a vendor might choose. See `resolveCreditLimitCents`.
 */
export function parseTierInput(
  body: Record<string, unknown>,
  opts: { partial: boolean }
): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  const data: Record<string, unknown> = {}

  if (body.name !== undefined || !opts.partial) {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return { ok: false, message: "name is required" }
    data.name = name
  }

  if (body.tier_type !== undefined || !opts.partial) {
    const raw = typeof body.tier_type === "string" ? body.tier_type.toUpperCase() : ""
    if (!Object.values(CustomerTierType).includes(raw as CustomerTierType)) {
      return {
        ok: false,
        message: `tier_type must be one of ${Object.values(CustomerTierType).join(", ")}`,
      }
    }
    data.tier_type = raw
  }

  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description : null
  }

  if (body.discount_percent !== undefined) {
    const v = Number(body.discount_percent)
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, message: "discount_percent must be between 0 and 100" }
    }
    data.discount_percent = v
  }

  if (body.payment_terms_days !== undefined) {
    const v = Number(body.payment_terms_days)
    if (!Number.isInteger(v) || v < 0 || v > MAX_TERMS_DAYS) {
      return {
        ok: false,
        message: `payment_terms_days must be a whole number of days from 0 to ${MAX_TERMS_DAYS}`,
      }
    }
    data.payment_terms_days = v
  }

  if (body.credit_limit_cents !== undefined) {
    if (body.credit_limit_cents === null) {
      data.credit_limit_cents = null
    } else {
      const v = Number(body.credit_limit_cents)
      if (!Number.isInteger(v) || v < 0) {
        return {
          ok: false,
          message: "credit_limit_cents must be a non-negative whole number of cents, or null for no limit",
        }
      }
      data.credit_limit_cents = v
    }
  }

  for (const flag of [
    "waive_order_minimum",
    "priority_fulfillment",
    "requires_application",
    "active",
  ] as const) {
    if (body[flag] !== undefined) {
      if (typeof body[flag] !== "boolean") {
        return { ok: false, message: `${flag} must be a boolean` }
      }
      data[flag] = body[flag]
    }
  }

  if (body.customer_ids !== undefined) {
    if (
      !Array.isArray(body.customer_ids) ||
      body.customer_ids.some((c) => typeof c !== "string" || !c.trim())
    ) {
      return { ok: false, message: "customer_ids must be an array of customer ids" }
    }
    data.customer_ids = [...new Set((body.customer_ids as string[]).map((c) => c.trim()))]
  }

  return { ok: true, data }
}

/** GET /vendor/customer-tiers — this vendor's tiers. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<VendorRulesService>(VENDOR_RULES_MODULE)
  const tiers = await service.listVendorCustomerTiers({ seller_id: sellerId })
  return res.json({ tiers })
}

/** POST /vendor/customer-tiers — create a tier. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const parsed = parseTierInput((req.body ?? {}) as Record<string, unknown>, {
    partial: false,
  })
  if (!parsed.ok) return res.status(400).json({ message: parsed.message })

  const service = req.scope.resolve<VendorRulesService>(VENDOR_RULES_MODULE)

  try {
    const [tier] = await service.createVendorCustomerTiers([
      {
        seller_id: sellerId,
        customer_ids: [] as unknown as Record<string, unknown>,
        active: true,
        ...(parsed.data as object),
      } as never,
    ])
    return res.status(201).json({ tier })
  } catch (err) {
    if (err instanceof InvalidTermsError) {
      return res.status(400).json({ message: err.message })
    }
    log.error("[POST /vendor/customer-tiers] failed", err)
    return res.status(500).json({ message: "Failed to create tier" })
  }
}
