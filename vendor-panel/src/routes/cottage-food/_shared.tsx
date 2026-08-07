import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Text } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"

/**
 * Shared types, data hooks, and display primitives for the cottage-food
 * surface.
 *
 * Presentation rule that runs through all of it: a limit the seller hasn't
 * declared renders as *nothing*, never as a zero or a full bar. And a seller
 * who is over a limit they declared sees a plain number, not an error state —
 * FBM reports their position and does not gate their sales.
 */

export type OperationType = "SHELF_STABLE" | "HOME_KITCHEN" | "BOTH"

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  SHELF_STABLE: "Shelf-stable goods (baked goods, jams, candy)",
  HOME_KITCHEN: "Cooked meals from my home kitchen",
  BOTH: "Both",
}

export const ALLERGEN_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "milk", label: "Milk" },
  { key: "eggs", label: "Eggs" },
  { key: "fish", label: "Fish" },
  { key: "crustacean_shellfish", label: "Crustacean shellfish" },
  { key: "tree_nuts", label: "Tree nuts" },
  { key: "peanuts", label: "Peanuts" },
  { key: "wheat", label: "Wheat" },
  { key: "soybeans", label: "Soybeans" },
  { key: "sesame", label: "Sesame" },
]

export interface CottageFoodProfile {
  id: string
  seller_id: string
  operation_type: OperationType
  jurisdiction_label: string | null
  state_code: string | null
  permit_number: string | null
  permit_type_label: string | null
  permit_issuer: string | null
  permit_issued_at: string | null
  permit_expires_at: string | null
  food_handler_cert_number: string | null
  food_handler_expires_at: string | null
  annual_sales_cap_cents: number | null
  cap_period_start_month: number
  daily_meal_cap: number | null
  weekly_meal_cap: number | null
  timezone: string
  allows_pickup: boolean
  allows_delivery: boolean
  allows_shipping: boolean
  allows_out_of_state: boolean
  allows_wholesale: boolean
  label_disclosure_text: string | null
  label_business_name: string | null
  label_address: string | null
  show_address_publicly: boolean
  public_disclosure_opt_in: boolean
}

export interface Meter {
  cap: number | null
  used: number
  pct: number | null
  remaining: number | null
}

export interface ComplianceSnapshot {
  has_profile: boolean
  profile: CottageFoodProfile | null
  operation_type: OperationType | null
  tracks_meals: boolean
  annual: Meter & {
    period_start: string | null
    period_end: string | null
    on_platform_cents: number
    self_reported_cents: number
  }
  today: Meter & { date: string | null }
  this_week: Meter & { week_start: string | null }
  permit: ExpiryView
  food_handler: ExpiryView
  advisories: string[]
}

export interface ExpiryView {
  status: "unset" | "ok" | "expiring_soon" | "expired"
  expires_at: string | null
  days_until: number | null
}

export interface SalesEntry {
  id: string
  source: "medusa_order" | "food_order" | "manual"
  source_id: string | null
  occurred_at: string
  amount_cents: number
  meal_count: number
  counts_toward_annual: boolean
  counts_toward_meals: boolean
  reverses_entry_id: string | null
  note: string | null
}

export interface CottageFoodLabel {
  id: string
  product_name: string
  net_weight_text: string | null
  ingredients: Array<{ name: string; note?: string }> | null
  allergens: string[] | null
  allergen_cross_contact_note: string | null
  disclosure_text_snapshot: string | null
  business_name_snapshot: string | null
  address_snapshot: string | null
  permit_number_snapshot: string | null
  seller_reviewed_at: string | null
  created_at: string
}

export interface RenderedLabel {
  label: CottageFoodLabel
  ingredients: string[]
  allergens: string[]
  text: string
  missing: string[]
}

export interface ChecklistItem {
  key: string
  label: string
  done: boolean
  why: string
}

// ---------------------------------------------------------------- data hooks

export const useComplianceSnapshot = () =>
  useQuery({
    queryKey: ["cottage-food", "compliance"],
    queryFn: () =>
      sdk.client.fetch<ComplianceSnapshot>("/vendor/cottage-food/compliance"),
  })

export const useCottageFoodProfile = () =>
  useQuery({
    queryKey: ["cottage-food", "profile"],
    queryFn: async () => {
      const res = await sdk.client.fetch<{ profile: CottageFoodProfile | null }>(
        "/vendor/cottage-food/profile"
      )
      return res.profile
    },
  })

export const useOnboardingStatus = () =>
  useQuery({
    queryKey: ["cottage-food", "onboarding"],
    queryFn: () =>
      sdk.client.fetch<{
        needs_setup: boolean
        profile: CottageFoodProfile | null
        checklist: ChecklistItem[]
        remaining?: number
      }>("/vendor/cottage-food/onboarding"),
  })

export const useSalesLedger = () =>
  useQuery({
    queryKey: ["cottage-food", "sales"],
    queryFn: () =>
      sdk.client.fetch<{ entries: SalesEntry[] }>("/vendor/cottage-food/sales"),
  })

export const useLabels = () =>
  useQuery({
    queryKey: ["cottage-food", "labels"],
    queryFn: () =>
      sdk.client.fetch<{ labels: CottageFoodLabel[] }>(
        "/vendor/cottage-food/labels"
      ),
  })

/** Invalidate everything the cottage-food surface reads. */
export const useInvalidateCottageFood = () => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ["cottage-food"] })
}

export const useSaveProfile = (onDone?: () => void) => {
  const invalidate = useInvalidateCottageFood()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      sdk.client.fetch<{ profile: CottageFoodProfile }>(
        "/vendor/cottage-food/profile",
        { method: "POST", body }
      ),
    onSuccess: () => {
      invalidate()
      onDone?.()
    },
  })
}

// ------------------------------------------------------------------ display

export const formatUsd = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export const formatDate = (value: string | null | undefined): string =>
  value ? new Date(value).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—"

/**
 * A meter for one declared limit.
 *
 * Renders nothing at all when `meter.cap` is null. That is the whole point:
 * an undeclared cap is not a cap of zero, and showing an empty bar would imply
 * FBM knows a limit it does not know.
 */
export const LimitMeter = ({
  title,
  meter,
  format = (n: number) => String(n),
  hint,
}: {
  title: string
  meter: Meter
  format?: (n: number) => string
  hint?: string
}) => {
  if (!meter.cap) {
    return (
      <div className="flex flex-col gap-y-1">
        <Text size="small" weight="plus">
          {title}
        </Text>
        <Text size="large" weight="plus">
          {format(meter.used)}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          No limit set — add one on the Profile tab to track it here.
        </Text>
      </div>
    )
  }

  const pct = meter.pct ?? 0
  const over = pct >= 100

  return (
    <div className="flex flex-col gap-y-2">
      <Text size="small" weight="plus">
        {title}
      </Text>
      <div className="flex items-baseline gap-x-2">
        <Text size="large" weight="plus">
          {format(meter.used)}
        </Text>
        <Text size="small" className="text-ui-fg-subtle">
          of {format(meter.cap)} ({pct}%)
        </Text>
      </div>
      {/*
        Neutral fill at every level, including over 100%. A seller past a
        limit they set gets a number, not a red alarm — this surface reports,
        it doesn't scold, and nothing here stops them selling.
      */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ui-bg-subtle">
        <div
          className="h-full rounded-full bg-ui-fg-muted transition-all"
          style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
        />
      </div>
      <Text size="xsmall" className="text-ui-fg-subtle">
        {over
          ? `${format(meter.used - meter.cap)} over the limit you set.`
          : `${format(meter.remaining ?? 0)} remaining.`}
        {hint ? ` ${hint}` : ""}
      </Text>
    </div>
  )
}

/** Permit / certification expiry line. */
export const ExpiryRow = ({
  title,
  view,
}: {
  title: string
  view: ExpiryView
}) => {
  const message = (() => {
    switch (view.status) {
      case "unset":
        return "No expiry date recorded."
      case "expired":
        return `Recorded expiry was ${formatDate(view.expires_at)}.`
      case "expiring_soon":
        return `Expires ${formatDate(view.expires_at)} — in ${view.days_until} days.`
      default:
        return `Expires ${formatDate(view.expires_at)}.`
    }
  })()

  return (
    <div className="flex flex-col gap-y-1">
      <Text size="small" weight="plus">
        {title}
      </Text>
      <Text size="small" className="text-ui-fg-subtle">
        {message}
      </Text>
    </div>
  )
}
