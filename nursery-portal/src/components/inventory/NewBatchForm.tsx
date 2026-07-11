import { useMemo, useState } from "react"
import { addWeeks, format } from "date-fns"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { USE_MOCK_DATA, api } from "@bmc/portal-kit"
import type { PropagationMethod } from "@/types"
import { PROPAGATION_WINDOWS } from "@/lib/seasonal-windows"

const METHODS: PropagationMethod[] = [
  "seed",
  "cutting",
  "plug",
  "bareroot",
  "division",
  "airlayer",
  "layering",
  "graft",
  "offset",
]

// New batch form. Expected ready date is auto-estimated from species reference
// data (weeks_to_saleable) when available. On save this would POST to
// /vendor/plant-nursery/inventory/batches and emit to the Blackout node room.
export function NewBatchForm({ onClose }: { onClose: () => void }) {
  const [species, setSpecies] = useState("")
  const [method, setMethod] = useState<PropagationMethod>("cutting")
  const [qty, setQty] = useState(20)
  const queryClient = useQueryClient()

  const estReadyDate = useMemo(() => {
    const match = PROPAGATION_WINDOWS.find((w) =>
      species.toLowerCase().includes(w.species.toLowerCase())
    )
    const weeks = match?.weeks_to_saleable ?? 16
    return addWeeks(new Date(), weeks)
  }, [species])
  const estReady = format(estReadyDate, "MMM d, yyyy")

  const createBatch = useMutation({
    mutationFn: async () => {
      const payload = {
        species_name: species,
        method,
        qty_started: qty,
        expected_ready_at: estReadyDate.toISOString(),
      }
      // In mock mode there is no backend to hit; resolve so the form still
      // closes cleanly. VITE_USE_MOCK_DATA=false wires this to the real route.
      if (USE_MOCK_DATA) return payload
      const { data } = await api.post(
        "/vendor/plant-nursery/propagation/batches",
        payload
      )
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["propagation"] })
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
      onClose()
    },
  })

  return (
    <form
      className="panel-pad space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        createBatch.mutate()
      }}
    >
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs text-ghost">Species</span>
          <input
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            required
            placeholder="e.g. Beautyberry"
            className="mt-1 w-full bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 placeholder:text-ghost focus:outline-none focus:border-forest-600"
          />
        </label>
        <label className="block">
          <span className="text-xs text-ghost">Method</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PropagationMethod)}
            className="mt-1 w-full bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 capitalize focus:outline-none focus:border-forest-600"
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-ghost">Quantity started</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="mt-1 w-full bg-soil border border-moss rounded-sm px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-forest-600"
          />
        </label>
      </div>
      <div className="text-xs text-mist">
        Estimated ready: <span className="text-forest-300">{estReady}</span>
      </div>
      {createBatch.isError && (
        <div className="text-xs text-red-400">
          Could not create batch. Please try again.
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="btn-primary text-sm"
          disabled={createBatch.isPending || !species.trim()}
        >
          {createBatch.isPending ? "Creating…" : "Create batch"}
        </button>
        <button type="button" className="btn-ghost text-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  )
}
