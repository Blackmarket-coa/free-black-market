import type { MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Maps the service's guards onto status codes. The guards are the point of
 * these endpoints — a refused cold-chain transfer or a double receive is a
 * conflict the caller can act on, not a 500.
 */
export function respondToServiceError(e: unknown, res: MedusaResponse): boolean {
  if (!(e instanceof MedusaError)) return false
  if (e.type === MedusaError.Types.NOT_FOUND) {
    res.status(404).json({ message: e.message })
    return true
  }
  if (e.type === MedusaError.Types.NOT_ALLOWED) {
    res.status(409).json({ message: e.message })
    return true
  }
  if (e.type === MedusaError.Types.INVALID_DATA) {
    res.status(400).json({ message: e.message })
    return true
  }
  return false
}

/** Parses `?demands=` JSON into allocation demands, or returns an error string. */
export function parseDemands(
  raw: unknown
): { demands: Array<{ demand_id: string; node_id: string; item_key: string; quantity: number; needed_by?: string | null }> } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { demands: [] }

  let parsed: unknown = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { error: "demands must be valid JSON" }
    }
  }
  if (!Array.isArray(parsed)) return { error: "demands must be an array" }

  const demands: Array<{
    demand_id: string
    node_id: string
    item_key: string
    quantity: number
    needed_by?: string | null
  }> = []

  for (const [i, entry] of parsed.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return { error: `demands[${i}] must be an object` }
    }
    const d = entry as Record<string, unknown>
    if (typeof d.node_id !== "string" || !d.node_id) {
      return { error: `demands[${i}].node_id is required` }
    }
    if (typeof d.item_key !== "string" || !d.item_key) {
      return { error: `demands[${i}].item_key is required` }
    }
    if (typeof d.quantity !== "number" || !Number.isFinite(d.quantity)) {
      return { error: `demands[${i}].quantity must be a number` }
    }
    demands.push({
      // A stable id per demand keeps the plan diffable across runs.
      demand_id:
        typeof d.demand_id === "string" && d.demand_id
          ? d.demand_id
          : `d_${i}_${d.node_id}_${d.item_key}`,
      node_id: d.node_id,
      item_key: d.item_key,
      quantity: d.quantity,
      needed_by: typeof d.needed_by === "string" ? d.needed_by : null,
    })
  }

  return { demands }
}
