/**
 * xp_event → karma_event mirror (W4, decision D7).
 *
 * `xp_event` was modelled after `karma_event` and carries all the
 * vendor-facing "karma" (grower + wellness ladders, quest rewards, order
 * XP), while `karma_event` is the canonical reputation log. Rather than
 * rewriting every XP writer, the canonical log absorbs XP by mirroring:
 * each xp_event row becomes a karma_event with
 * `source_module: "progression", source_id: <xp_event.id>` — so the
 * partial-unique dedup index makes the mirror idempotent, re-runs are
 * free, and every XP path (present and future) is captured at one seam.
 *
 * Consumers keep reading xp_event exactly as before: xp_event is now the
 * first derived per-context projection of the canonical log (they share
 * rows one-to-one by construction). The scheduled job
 * (`jobs/progression-karma-mirror.ts`) is the thin wrapper, per the
 * asset-graph reconciler precedent.
 */

export interface MirrorableXpEvent {
  id: string
  customer_id: string
  role?: string | null
  amount: number
  reason: string
  source_module?: string | null
  source_id?: string | null
  occurred_at: Date | string
}

export interface KarmaMirrorInput {
  member_id: string
  delta: number
  reason: string
  source_module: "progression"
  source_id: string
  occurred_at: Date | string
  metadata: Record<string, unknown>
}

/** Mirror-side copy of the canonical write path's constraints. */
const REASON_RE = /^[a-z0-9][a-z0-9:_.-]{0,63}$/
const MAX_DELTA = 10_000

/**
 * Normalize an XP reason into the karma slug vocabulary. The known XP
 * vocabulary (`order-placed`, `grower:order_placed`, `wellness:…`) is
 * already conformant; anything else is lowercased with invalid runs
 * collapsed to `-` so a single unconventional writer cannot wedge the
 * mirror.
 */
export function normalizeKarmaReason(reason: string): string {
  if (REASON_RE.test(reason)) return reason
  const normalized = reason
    .toLowerCase()
    .replace(/[^a-z0-9:_.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64)
  return REASON_RE.test(normalized) ? normalized : "xp-event"
}

/**
 * Map one xp_event onto the canonical write-path input, or return null
 * when the row is not mirrorable (zero delta — karma events must move
 * something; out-of-cap magnitudes are clamped, not dropped, so the log
 * never silently loses an award).
 */
export function buildKarmaMirrorInput(
  xp: MirrorableXpEvent
): KarmaMirrorInput | null {
  if (!Number.isInteger(xp.amount) || xp.amount === 0) return null
  const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, xp.amount))
  return {
    member_id: xp.customer_id,
    delta,
    reason: normalizeKarmaReason(xp.reason),
    source_module: "progression",
    source_id: xp.id,
    occurred_at: xp.occurred_at,
    metadata: {
      xp_event_id: xp.id,
      ...(xp.role ? { role: xp.role } : {}),
      ...(xp.source_module ? { xp_source_module: xp.source_module } : {}),
      ...(xp.source_id ? { xp_source_id: xp.source_id } : {}),
      ...(delta !== xp.amount ? { clamped_from: xp.amount } : {}),
    },
  }
}

export interface KarmaMirrorSummary {
  scanned: number
  mirrored: number
  already_mirrored: number
  skipped: number
  failed: number
  errors: string[]
}

/**
 * Sweep the XP log into the canonical karma log. Parameterized on the
 * two service surfaces so it is testable with fakes (the
 * reconcileAllUnsettled idiom). Never throws on a per-row failure.
 */
export async function mirrorXpEventsToKarma(
  progression: {
    listXpEvents: (
      filter: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<MirrorableXpEvent[]>
  },
  hawala: {
    recordKarmaEvent: (
      input: KarmaMirrorInput
    ) => Promise<{ event: { id: string }; created: boolean }>
  }
): Promise<KarmaMirrorSummary> {
  const summary: KarmaMirrorSummary = {
    scanned: 0,
    mirrored: 0,
    already_mirrored: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  // Full sweep: idempotency makes re-mirroring free, and volumes are
  // modest pre-launch. A created-at cursor is the recorded follow-up if
  // the XP log grows hot (AUDIT_DEBT §W4).
  const events = await progression.listXpEvents(
    {},
    { take: null as unknown as number }
  )

  for (const xp of events) {
    summary.scanned += 1
    const input = buildKarmaMirrorInput(xp)
    if (!input) {
      summary.skipped += 1
      continue
    }
    try {
      const { created } = await hawala.recordKarmaEvent(input)
      if (created) summary.mirrored += 1
      else summary.already_mirrored += 1
    } catch (error) {
      summary.failed += 1
      summary.errors.push(
        `${xp.id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return summary
}
