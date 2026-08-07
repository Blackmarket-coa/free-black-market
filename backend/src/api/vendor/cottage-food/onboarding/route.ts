import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COTTAGE_FOOD_MODULE } from "../../../../modules/cottage-food"
import type CottageFoodModuleService from "../../../../modules/cottage-food/service"
import { getSellerId } from "../../quests/_helpers"
import { sanitizeProfileInput } from "../_helpers"

interface ChecklistItem {
  key: string
  label: string
  done: boolean
  /** Why a home producer would want this filled in. */
  why: string
}

/**
 * GET /vendor/cottage-food/onboarding
 *
 * Setup status for the cottage-food surface: whether the seller has a profile
 * at all, and a checklist of what's still blank.
 *
 * The checklist is a prompt, not a gate. Every item is optional and a seller
 * can sell with none of them filled in — the point is that a person cooking
 * out of their kitchen usually *wants* these tracked and simply hasn't been
 * asked. Ordering runs cheapest-and-most-useful first.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const profile = await service.getProfileForSeller(sellerId)

  if (!profile) {
    return res.json({
      needs_setup: true,
      profile: null,
      checklist: [],
    })
  }

  const tracksMeals =
    profile.operation_type === "HOME_KITCHEN" || profile.operation_type === "BOTH"

  const checklist: ChecklistItem[] = [
    {
      key: "jurisdiction",
      label: "Where you're permitted",
      done: Boolean(profile.jurisdiction_label || profile.state_code),
      why: "Cottage food rules are often set county by county, not just by state.",
    },
    {
      key: "disclosure",
      label: "Your home-kitchen label sentence",
      done: Boolean(profile.label_disclosure_text),
      why: "Most jurisdictions require exact wording on every label. Paste yours once and it goes on every label you generate.",
    },
    {
      key: "permit",
      label: "Permit number and expiry",
      done: Boolean(profile.permit_number),
      why: "Your permit number belongs on your labels, and an expiry date lets FBM remind you before it lapses.",
    },
    {
      key: "annual_cap",
      label: "Your annual sales cap",
      done: Boolean(profile.annual_sales_cap_cents),
      why: "Tracking your own declared cap is the only way to see it coming before you cross it.",
    },
    {
      key: "food_handler",
      label: "Food handler certification",
      done: Boolean(profile.food_handler_cert_number),
      why: "Same reminder logic as the permit.",
    },
  ]

  if (tracksMeals) {
    checklist.push({
      key: "meal_caps",
      label: "Daily and weekly meal limits",
      done: Boolean(profile.daily_meal_cap || profile.weekly_meal_cap),
      why: "Home kitchens selling cooked meals are usually capped per day and per week, not just per year.",
    })
  }

  res.json({
    needs_setup: false,
    profile,
    checklist,
    remaining: checklist.filter((c) => !c.done).length,
  })
}

/**
 * POST /vendor/cottage-food/onboarding
 *
 * Create the profile during registration. Accepts the same fields as the
 * profile route, and accepts an entirely empty body — a seller can opt into
 * the cottage-food surface now and fill in the details later, which is the
 * realistic path for someone who doesn't have their permit in hand yet.
 */
export const POST = async (
  req: MedusaRequest<Record<string, unknown>>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const service = req.scope.resolve<CottageFoodModuleService>(COTTAGE_FOOD_MODULE)
  const patch = sanitizeProfileInput(req.body ?? {})

  await service.upsertProfileForSeller(sellerId, patch)
  const profile = await service.getProfileForSeller(sellerId)

  res.status(201).json({ profile })
}
