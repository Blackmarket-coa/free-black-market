/**
 * WellnessAutomationService — sends automated Blackout (Matrix) DMs on behalf of
 * a practitioner, with an email fallback. A plain container-backed class (like
 * `progression/grower-karma.ts`'s GrowerKarmaService), NOT a MedusaService — it
 * orchestrates the wellness module, the Matrix service, and notifications.
 *
 * All sends are best-effort and rate limited: max 50 sends/hour per seller, and
 * bulk sends are spaced 500ms apart so we never fire a burst at the homeserver.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../../shared/logger"
import { getMatrixService } from "../../shared/matrix-service"
import { BOOKING_MODULE } from "../booking"
import type BookingService from "../booking/service"
import { WELLNESS_MODULE } from "./index"
import type WellnessModuleService from "./service"

const log = createLogger("modules/wellness/automation")

const MAX_SENDS_PER_HOUR = 50
const BULK_SPACING_MS = 500

/** Bracket-variable substitution. Unknown tokens are left literal. */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>
): string {
  return body.replace(/\[([a-z_]+)\]/gi, (match, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? match : String(v)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Per-seller send window (in-memory; mirrors the hawala rate-limiter idiom).
const sendWindow = new Map<string, { count: number; resetAt: number }>()

function takeSendBudget(sellerId: string): boolean {
  const now = Date.now()
  let rec = sendWindow.get(sellerId)
  if (!rec || rec.resetAt < now) {
    rec = { count: 0, resetAt: now + 3_600_000 }
    sendWindow.set(sellerId, rec)
  }
  if (rec.count >= MAX_SENDS_PER_HOUR) return false
  rec.count++
  return true
}

export interface SendDMResult {
  channel: "matrix" | "email" | "skipped"
  ok: boolean
}

export class WellnessAutomationService {
  private readonly container: MedusaContainer

  constructor(container: MedusaContainer) {
    this.container = container
  }

  private get wellness(): WellnessModuleService {
    return this.container.resolve(WELLNESS_MODULE) as WellnessModuleService
  }

  /**
   * Send a single DM. Prefers a Matrix room between practitioner and recipient;
   * falls back to email. Honors the per-seller hourly budget. Never throws.
   */
  async sendDM(params: {
    seller_id: string
    recipient_email: string
    recipient_name?: string | null
    recipient_mxid?: string | null
    body: string
    channel?: "matrix" | "email"
    practitioner_name?: string | null
  }): Promise<SendDMResult> {
    if (!takeSendBudget(params.seller_id)) {
      log.warn(`[wellness automation] hourly send budget hit for ${params.seller_id}`)
      return { channel: "skipped", ok: false }
    }

    const wantMatrix = (params.channel ?? "matrix") === "matrix"
    if (wantMatrix) {
      try {
        const matrix = getMatrixService()
        if (matrix) {
          const recipientMxid =
            params.recipient_mxid ||
            matrix.buildMxid(`client-${params.recipient_email}`)
          // Ensure the recipient exists, then a room the practitioner can see.
          await matrix.ensureUser(
            `client-${params.recipient_email}`,
            params.recipient_name || params.recipient_email,
            { email: params.recipient_email }
          )
          const alias = matrix.sanitizeLocalpart(
            `wellness-${params.seller_id}-${params.recipient_email}`
          )
          const roomId = await matrix.ensureRoom({
            alias,
            name: params.practitioner_name || "Wellness",
            invite: [recipientMxid],
          })
          if (roomId) {
            const ok = await matrix.sendMessage(roomId, params.body)
            if (ok) return { channel: "matrix", ok: true }
          }
        }
      } catch (err) {
        log.warn(`[wellness automation] matrix send failed; falling back to email`, err)
      }
    }

    // Email fallback.
    try {
      const notification = this.container.resolve("notification") as unknown as {
        createNotifications: (p: Record<string, unknown>) => Promise<unknown>
      }
      await notification.createNotifications({
        to: params.recipient_email,
        channel: "email",
        template: "wellness-automation",
        data: {
          body: params.body,
          recipient_name: params.recipient_name ?? null,
          practitioner_name: params.practitioner_name ?? null,
        },
      })
      return { channel: "email", ok: true }
    } catch (err) {
      log.warn(`[wellness automation] email fallback failed`, err)
      return { channel: "email", ok: false }
    }
  }

  /**
   * Load the seller's template for `trigger` (seeding defaults first), render it,
   * and send to each recipient with bulk spacing. Skips disabled templates.
   */
  async runTrigger(params: {
    seller_id: string
    trigger: string
    vars: Record<string, string | number | null | undefined>
    recipients: Array<{ email: string; name?: string | null; mxid?: string | null }>
    practitioner_name?: string | null
  }): Promise<{ sent: number; skipped: number }> {
    let sent = 0
    let skipped = 0
    try {
      const template = (await this.wellness.getTemplate(
        params.seller_id,
        params.trigger
      )) as { body: string; channel?: string; enabled?: boolean } | null
      if (!template || !template.enabled) {
        return { sent: 0, skipped: params.recipients.length }
      }

      const body = renderTemplate(template.body, params.vars)
      for (let i = 0; i < params.recipients.length; i++) {
        const r = params.recipients[i]
        const result = await this.sendDM({
          seller_id: params.seller_id,
          recipient_email: r.email,
          recipient_name: r.name,
          recipient_mxid: r.mxid,
          body,
          channel: (template.channel as "matrix" | "email") ?? "matrix",
          practitioner_name: params.practitioner_name,
        })
        if (result.ok) sent++
        else skipped++
        if (i < params.recipients.length - 1) await sleep(BULK_SPACING_MS)
      }
    } catch (err) {
      log.error(`[wellness automation] runTrigger ${params.trigger} failed`, err)
    }
    return { sent, skipped }
  }

  /**
   * The next `count` available booking slots across the practitioner's session
   * types, formatted for the `[available_slots]` template variable, e.g.
   * "Mon Mar 15 at 10am | Tue Mar 16 at 2pm". Returns "" on any failure.
   * Delegates slot math to the existing `booking` module's slot engine.
   */
  async getNextAvailableSlots(seller_id: string, count = 3): Promise<string> {
    try {
      const slots = await this.collectUpcomingSlots(seller_id, count, 14)
      const fmt = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
      })
      return slots
        .slice(0, count)
        .map((s) => fmt.format(new Date(s.starts_at)))
        .join(" | ")
    } catch {
      return ""
    }
  }

  /** Scan the next `horizonDays` days across active session types for open slots. */
  async collectUpcomingSlots(
    seller_id: string,
    count: number,
    horizonDays: number
  ): Promise<Array<{ starts_at: string; ends_at: string }>> {
    const booking = this.container.resolve(BOOKING_MODULE) as BookingService
    const sessionTypes = (await this.wellness.listSessionTypes({
      seller_id,
      is_active: true,
    })) as Array<{ product_id: string | null }>

    const productIds = sessionTypes
      .map((s) => s.product_id)
      .filter((p): p is string => Boolean(p))
    if (!productIds.length) return []

    const out: Array<{ starts_at: string; ends_at: string }> = []
    const today = new Date()
    for (let d = 0; d < horizonDays && out.length < count; d++) {
      const day = new Date(today.getTime() + d * 86_400_000)
      const date = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(day)
      for (const product_id of productIds) {
        try {
          const slots = await booking.generateSlots({ seller_id, product_id, date })
          out.push(...slots)
        } catch {
          /* skip non-bookable products */
        }
      }
    }
    out.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    return out.slice(0, count)
  }
}
