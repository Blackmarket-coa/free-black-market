import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ownedLot } from "../../../_access"

// Type for agriculture service methods
interface AgricultureServiceType {
  createHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateHarvests: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteHarvests: (id: string) => Promise<void>
  createLots: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateLots: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteLots: (id: string) => Promise<void>
  createAvailabilityWindows: (data: Record<string, unknown>) => Promise<{ id: string }>
}

/**
 * POST /vendor/farm/lots/:id/surplus
 * Mark a lot as surplus
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const lotId = req.params.id

  try {
    // The lot must be the caller's own, through its harvest: this checked only
    // that the caller had some farm profile. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId)
    if (!owned) return

    const { reason } = req.body as Record<string, unknown>

    // Update the lot to mark as surplus
    const lot = await agricultureService.updateLots({
      id: lotId,
      surplus_flag: true,
      surplus_declared_at: new Date().toISOString(),
      surplus_reason: reason || "Excess inventory",
    })

    res.json({ lot })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to mark lot as surplus", 
      error: error.message 
    })
  }
}

/**
 * DELETE /vendor/farm/lots/:id/surplus
 * Remove surplus flag from a lot
 */
export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const agricultureService = req.scope.resolve("agriculture") as AgricultureServiceType
  const lotId = req.params.id

  try {
    // The lot must be the caller's own, through its harvest: this checked only
    // that the caller had some farm profile. Missing or not the caller's: 403.
    const owned = await ownedLot(req, res, lotId)
    if (!owned) return

    // Update the lot to remove surplus flag
    const lot = await agricultureService.updateLots({
      id: lotId,
      surplus_flag: false,
      surplus_declared_at: null,
      surplus_reason: null,
    })

    res.json({ lot })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to remove surplus flag", 
      error: error.message 
    })
  }
}
