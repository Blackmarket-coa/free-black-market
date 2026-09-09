"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { addCycleProductToCart } from "@/lib/data/order-cycles"

/**
 * Put one cycle item in the cart.
 *
 * The refusal path is the interesting half. `addCycleProductToCart` asks the
 * cycle first and returns its own wording — "Only 2 units available",
 * "Order cycle is closed, not accepting orders" — rather than a generic
 * failure, and nothing has entered the cart when it refuses. When the limit is
 * what failed, the cycle also says how many are left, so the message can offer
 * that number instead of leaving the buyer to guess.
 */
export default function AddCycleItem({
  orderCycleId,
  variantId,
  locale,
  maxQuantity,
}: {
  orderCycleId: string
  variantId: string
  locale: string
  /** Remaining in the cycle; null means no limit was set. */
  maxQuantity: number | null
}) {
  const router = useRouter()
  const [quantity, setQuantity] = useState(1)
  const [state, setState] = useState<"idle" | "adding" | "added" | "refused" | "error">(
    "idle"
  )
  const [message, setMessage] = useState("")

  async function add() {
    setState("adding")
    setMessage("")

    try {
      const result = await addCycleProductToCart({
        orderCycleId,
        variantId,
        quantity,
        countryCode: locale,
      })

      if (!result.ok) {
        setState("refused")
        setMessage(
          result.maxQuantity !== undefined
            ? `${result.reason} — try ${result.maxQuantity} or fewer.`
            : result.reason
        )
        // The cycle's numbers moved under us; re-render with the current ones.
        router.refresh()
        return
      }

      setState("added")
      router.refresh()
    } catch (err) {
      setState("error")
      setMessage(err instanceof Error ? err.message : "Could not add that.")
    }
  }

  const cap = maxQuantity ?? undefined

  return (
    <div className="shrink-0 text-right">
      <div className="flex items-center justify-end gap-2">
        <label className="sr-only" htmlFor={`qty-${variantId}`}>
          Quantity
        </label>
        <input
          id={`qty-${variantId}`}
          type="number"
          min={1}
          max={cap}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 rounded-md border px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={state === "adding"}
          data-testid={`add-cycle-item-${variantId}`}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-60"
        >
          {state === "adding" ? "Adding…" : "Add"}
        </button>
      </div>

      {state === "added" ? (
        <p className="mt-2 text-xs text-green-700">In your cart.</p>
      ) : null}
      {state === "refused" ? (
        <p className="mt-2 max-w-[16rem] text-xs text-amber-700">{message}</p>
      ) : null}
      {state === "error" ? (
        <p className="mt-2 max-w-[16rem] text-xs text-red-700">{message}</p>
      ) : null}
    </div>
  )
}
