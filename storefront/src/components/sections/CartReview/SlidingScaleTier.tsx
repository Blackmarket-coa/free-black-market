"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/atoms"
import { updateCart } from "@/lib/data/cart"

/**
 * Three-tier sliding-scale buyer picker, surfaced at checkout for any
 * non-Stall vendor product. The tier choice is captured as
 * `cart.metadata.tier` and read by a workflow hook on the backend
 * (`apply-tier-pricing`) which picks the matching Mercur price-list
 * variant.
 *
 * The tier copy is intentionally non-justifying: there's no income
 * verification and no honor-system disclaimer. Sliding-scale economics
 * collapse if the platform polices the choice; trust is the model.
 *
 * See `docs/COMPOSITION_LAYER.md` and `docs/PLAYBOOK_SYSTEM.md`
 * (allow_sliding_scale per playbook).
 */
export type SlidingScaleTier = "supporter" | "standard" | "solidarity"

type TierOption = {
  value: SlidingScaleTier
  label: string
  description: string
}

const TIERS: TierOption[] = [
  {
    value: "supporter",
    label: "Supporter",
    description:
      "I'm covering my own share and a bit more. Pays above standard so others can pay less.",
  },
  {
    value: "standard",
    label: "Standard",
    description: "The listed price. The default.",
  },
  {
    value: "solidarity",
    label: "Solidarity",
    description:
      "I need a lower price right now. Covered by the solidarity pool and supporters.",
  },
]

type Props = {
  initialTier?: SlidingScaleTier
  /** Optional vendor-set blurb shown above the tier list. */
  vendorBlurb?: string
}

export default function SlidingScaleTier({ initialTier, vendorBlurb }: Props) {
  const [isPending, startTransition] = useTransition()
  const [tier, setTier] = useState<SlidingScaleTier>(initialTier ?? "standard")
  const [savedTier, setSavedTier] = useState<SlidingScaleTier | null>(
    initialTier ?? null
  )

  const handleSave = () => {
    startTransition(async () => {
      await updateCart({ metadata: { tier } })
      setSavedTier(tier)
    })
  }

  const dirty = tier !== savedTier

  return (
    <div className="w-full mb-6 border rounded-sm p-4 bg-white">
      <h3 className="font-semibold mb-1">Sliding-scale pricing</h3>
      <p className="text-sm text-gray-600 mb-3">
        {vendorBlurb ??
          "This vendor offers a three-tier sliding scale. Pick what fits your situation — no questions asked."}
      </p>

      <div className="space-y-2">
        {TIERS.map((option) => {
          const selected = tier === option.value
          return (
            <label
              key={option.value}
              className={
                "flex gap-3 items-start p-3 rounded border cursor-pointer transition-all " +
                (selected
                  ? "border-black bg-gray-50"
                  : "border-gray-200 hover:border-gray-400")
              }
            >
              <input
                type="radio"
                name="sliding-scale-tier"
                value={option.value}
                checked={selected}
                onChange={() => setTier(option.value)}
                className="mt-1"
              />
              <span className="flex flex-col">
                <span className="font-medium text-sm">{option.label}</span>
                <span className="text-xs text-gray-600 mt-0.5">
                  {option.description}
                </span>
              </span>
            </label>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {savedTier
            ? `Saved: ${savedTier.charAt(0).toUpperCase() + savedTier.slice(1)}`
            : "Tier not yet saved"}
        </span>
        <Button size="small" onClick={handleSave} loading={isPending} disabled={!dirty}>
          {dirty ? "Save tier" : "Saved"}
        </Button>
      </div>
    </div>
  )
}
