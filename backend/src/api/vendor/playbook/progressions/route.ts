import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/vendor/playbook/progressions")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { requireSellerId } from "../../../../shared"
import {
  PLAYBOOK_MODULE,
  PLAYBOOK_IDS,
  groupByEngine,
  resolveProgressionsFrom,
  TERMINAL_PLAYBOOKS,
} from "../../../../modules/playbook"
import type { PlaybookId } from "../../../../modules/playbook"
import type PlaybookService from "../../../../modules/playbook/service"
import {
  loadSellerListings,
  strandedFor,
} from "../../../../shared/playbook-preflight"

/**
 * GET /vendor/playbook/progressions
 *
 * Where a vendor's current playbook commonly leads, and what each move would
 * change. Read-only.
 *
 * This is a map, not a prompt. Nothing here is a recommendation, nothing is
 * ranked by desirability, and the surface that renders it is opened rather than
 * pushed — `docs/PLAYBOOK_SYSTEM.md` calls the playbook system "the firewall
 * that prevents solo sellers from being conscripted into cooperation they did
 * not ask for", and a vendor who stays where they are is not behind.
 *
 * Each edge carries the losses as well as the gains, plus a count of the
 * seller's own listings the target playbook would not allow. Existing products
 * are never invalidated by a switch (allowed-listing-types is enforced on
 * write, not retroactively) — but the next edit of one would be rejected, and
 * that is worth knowing beforehand.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  // `?from=` asks where a playbook the seller is *considering* would lead. The
  // onboarding picker uses it, because at that point there is no assignment to
  // read from yet — and it keeps the graph in one place rather than mirroring
  // it into the panel.
  const fromParam = req.query?.from
  const hypothetical =
    typeof fromParam === "string" && PLAYBOOK_IDS.includes(fromParam as PlaybookId)
      ? (fromParam as PlaybookId)
      : undefined

  if (typeof fromParam === "string" && !hypothetical) {
    return res.status(400).json({
      type: "invalid_data",
      message: `Invalid from: ${fromParam}. Must be one of ${PLAYBOOK_IDS.join(", ")}`,
    })
  }

  try {
    const playbookService = req.scope.resolve<PlaybookService>(PLAYBOOK_MODULE)

    let current: PlaybookId | undefined = hypothetical
    if (!current) {
      const [assignment] = await playbookService.listPlaybookAssignments({
        seller_id: sellerId,
      })
      current = assignment?.recipe_id as PlaybookId | undefined
    }

    // No assignment yet (legacy seller, or onboarding not finished) and no
    // `from` given. There is no origin, so there is nothing honest to show.
    if (!current) {
      return res.json({
        current_playbook: null,
        groups: [],
        progressions: [],
        is_terminal: false,
        history: [],
        listings_checked: false,
      })
    }
    const edges = resolveProgressionsFrom(current)

    // Skip the listing preflight for a hypothetical origin: the seller's
    // listings say nothing useful about moves out of a playbook they are not
    // on, and a count shown there would be answering a question nobody asked.
    // One product read covers every candidate target, not one per edge.
    const loaded = hypothetical
      ? { listings: [], checked: false }
      : await loadSellerListings(req.scope, sellerId)

    const progressions = edges.map((edge) => ({
      ...edge,
      preflight: strandedFor(loaded, edge.to),
    }))

    const byTo = new Map(progressions.map((p) => [p.to, p]))
    const groups = groupByEngine(edges).map((group) => ({
      engine: group.engine,
      label: group.label,
      edges: group.edges.map((e) => byTo.get(e.to) ?? e),
    }))

    let history: unknown[] = []
    try {
      history = await playbookService.listTransitionsForSeller(sellerId)
    } catch (historyError: unknown) {
      // History is context, not the payload — an empty trail is better than a
      // failed panel.
      const message =
        historyError instanceof Error ? historyError.message : "unknown"
      log.warn(`[GET /vendor/playbook/progressions] history read failed: ${message}`)
    }

    return res.json({
      current_playbook: current,
      groups,
      progressions,
      /** True when this playbook is the end of its ladders (today: `hub`). */
      is_terminal: TERMINAL_PLAYBOOKS.includes(current),
      history,
      /**
       * False when the listing read failed. The counts are zero in that case
       * and must not be shown as "nothing would be stranded".
       */
      listings_checked: loaded.checked,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /vendor/playbook/progressions] Error:", message)
    return res.status(500).json({
      type: "server_error",
      message: "Failed to load playbook progressions",
    })
  }
}
