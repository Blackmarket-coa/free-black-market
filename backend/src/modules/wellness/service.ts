import { MedusaService } from "@medusajs/framework/utils"
import SessionType from "./models/session-type"
import ClassEvent from "./models/class-event"
import ClassAttendee from "./models/class-attendee"
import ClientProfile from "./models/client-profile"
import ClientNote from "./models/client-note"
import IntakeForm from "./models/intake-form"
import IntakeResponse from "./models/intake-response"
import MembershipTier from "./models/membership-tier"
import Member from "./models/member"
import AutomationTemplate from "./models/automation-template"
import type { AutomationTrigger } from "./models/automation-template"
import { LIVE_CLASS_STATUSES, classRegistrationRefusal } from "./class-registration"

/**
 * Default Blackout automation copy, seeded (disabled) on first read so the
 * practitioner can toggle/edit rather than author from scratch. Bracket
 * variables are substituted by WellnessAutomationService.renderTemplate.
 */
const DEFAULT_AUTOMATIONS: Array<{
  trigger: AutomationTrigger
  name: string
  body: string
  offset_minutes?: number | null
}> = [
  {
    trigger: "booking_confirmed",
    name: "Booking confirmed",
    body:
      "Hi [name]! Your [session_type] is confirmed for [date] at [time]. " +
      "Please fill out your intake form before our session: [link]. Looking forward to working with you. 🌿",
  },
  {
    trigger: "booking_reminder_24h",
    name: "24-hour reminder",
    body:
      "Just a reminder that your [session_type] is tomorrow at [time]. " +
      "Please reach out if you need to reschedule.",
    offset_minutes: 1440,
  },
  {
    trigger: "booking_reminder_1h",
    name: "1-hour reminder",
    body: "Your [session_type] starts in about an hour ([time]). See you soon. 🌿",
    offset_minutes: 60,
  },
  {
    trigger: "booking_completed",
    name: "Post-session follow-up",
    body:
      "Thank you for our session today. Take time to rest and drink plenty of water. " +
      "If you'd like to share your experience, a review helps others find this work: [link]. " +
      "Your next session credit is available — book here: [link]",
  },
  {
    trigger: "no_show",
    name: "No-show note",
    body:
      "Hi [name], I missed you at our [session_type] today. Reach out whenever you'd like to reschedule.",
  },
  {
    trigger: "class_registered",
    name: "Class registration confirmed",
    body:
      "You're registered for [session_type] on [date] at [time]! Here's what to bring and where to meet: [link]",
  },
  {
    trigger: "class_reminder",
    name: "Class reminder",
    body: "Reminder: [session_type] is coming up on [date] at [time]. Can't wait to see you there!",
    offset_minutes: 1440,
  },
  {
    trigger: "recording_available",
    name: "Class recording available",
    body: "The recording from [session_type] is now available: [link]",
  },
  {
    trigger: "membership_welcome",
    name: "Membership welcome",
    body:
      "Welcome to [tier]! 🌸 You now have access to the community room and [credits] session credit(s). " +
      "Book here: [link]. So glad to have you in this space.",
  },
  {
    trigger: "membership_renewed",
    name: "Membership renewed",
    body:
      "Your [tier] membership renewed and your [credits] session credit(s) are ready. Book here: [link]",
  },
  {
    trigger: "credits_low",
    name: "Unused credit reminder",
    body:
      "Hi [name] — your session credit(s) expire soon. You have [credits] remaining. " +
      "Here are my next openings: [available_slots]. Book here: [link]",
  },
  {
    trigger: "reengagement",
    name: "Re-engagement",
    body:
      "Hi [name], I've been thinking about you and wanted to check in. " +
      "I have availability soon: [available_slots]. Book here: [link]",
  },
]

class WellnessModuleService extends MedusaService({
  SessionType,
  ClassEvent,
  ClassAttendee,
  ClientProfile,
  ClientNote,
  IntakeForm,
  IntakeResponse,
  MembershipTier,
  Member,
  AutomationTemplate,
}) {
  // ---- Automation templates -------------------------------------------------

  /** Idempotently seed the disabled default templates for a seller. */
  async seedDefaultAutomationTemplates(sellerId: string): Promise<void> {
    const existing = (await this.listAutomationTemplates({
      seller_id: sellerId,
    })) as Array<{ trigger: string }>
    const have = new Set(existing.map((t) => t.trigger))
    const missing = DEFAULT_AUTOMATIONS.filter((d) => !have.has(d.trigger))
    if (!missing.length) return
    await this.createAutomationTemplates(
      missing.map((d) => ({
        seller_id: sellerId,
        trigger: d.trigger,
        name: d.name,
        body: d.body,
        channel: "matrix",
        enabled: false,
        offset_minutes: d.offset_minutes ?? null,
      }))
    )
  }

  /** A seller's template for a trigger, seeding defaults first. */
  async getTemplate(sellerId: string, trigger: string) {
    await this.seedDefaultAutomationTemplates(sellerId)
    const rows = (await this.listAutomationTemplates(
      { seller_id: sellerId, trigger },
      { take: 1 }
    )) as Array<Record<string, unknown>>
    return rows?.[0] ?? null
  }

  // ---- Client CRM -----------------------------------------------------------

  /** Get-or-create a client profile, scoped to the seller (one per email). */
  async upsertClientProfile(
    sellerId: string,
    input: { email: string; name?: string | null; phone?: string | null; customer_id?: string | null }
  ) {
    const existing = (await this.listClientProfiles(
      { seller_id: sellerId, email: input.email },
      { take: 1 }
    )) as Array<{ id: string }>
    if (existing?.[0]) {
      const patch: Record<string, unknown> = { id: existing[0].id, last_seen_at: new Date() }
      if (input.name) patch.name = input.name
      if (input.phone) patch.phone = input.phone
      if (input.customer_id) patch.customer_id = input.customer_id
      const updated = await this.updateClientProfiles(patch)
      return Array.isArray(updated) ? updated[0] : updated
    }
    return this.createClientProfiles({
      seller_id: sellerId,
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      customer_id: input.customer_id ?? null,
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    })
  }

  async addClientNote(input: {
    seller_id: string
    client_profile_id: string
    booking_id?: string | null
    body: string
    is_private?: boolean
    author_member_id?: string | null
  }) {
    return this.createClientNotes({
      seller_id: input.seller_id,
      client_profile_id: input.client_profile_id,
      booking_id: input.booking_id ?? null,
      body: input.body,
      is_private: input.is_private ?? true,
      author_member_id: input.author_member_id ?? null,
    })
  }

  // ---- Membership credits ---------------------------------------------------

  /** Add a period's credit allowance to a member, resetting used-this-period. */
  async allocateCreditsForPeriod(memberId: string, periodEnd?: Date | null) {
    const member = (await this.retrieveMember(memberId)) as Record<string, unknown>
    const tier = (await this.retrieveMembershipTier(
      member.membership_tier_id as string
    )) as Record<string, unknown>
    const grant = Number(tier.credits_per_period ?? 0)
    const rollOver = Boolean(tier.credits_roll_over)
    const prevBalance = rollOver ? Number(member.credits_balance ?? 0) : 0
    return this.updateMembers({
      id: memberId,
      credits_balance: prevBalance + grant,
      credits_used_this_period: 0,
      credits_allocated_total: Number(member.credits_allocated_total ?? 0) + grant,
      current_period_end: periodEnd ?? (member.current_period_end as Date | null) ?? null,
    })
  }

  /** Atomically consume `amount` credits; returns false if insufficient. */
  async consumeCredit(memberId: string, amount = 1): Promise<boolean> {
    const member = (await this.retrieveMember(memberId)) as Record<string, unknown>
    const balance = Number(member.credits_balance ?? 0)
    if (balance < amount) return false
    await this.updateMembers({
      id: memberId,
      credits_balance: balance - amount,
      credits_used_this_period: Number(member.credits_used_this_period ?? 0) + amount,
    })
    return true
  }

  /** Count of active members for a seller (used for milestone checks + MRR). */
  async countActiveMembers(sellerId: string): Promise<number> {
    const rows = (await this.listMembers({
      seller_id: sellerId,
      status: "active",
    })) as unknown[]
    return rows.length
  }

  /** Monthly recurring revenue in cents (active members × tier price). */
  async computeMrrAmount(sellerId: string): Promise<number> {
    const members = (await this.listMembers({
      seller_id: sellerId,
      status: "active",
    })) as Array<{ membership_tier_id: string }>
    if (!members.length) return 0
    const tiers = (await this.listMembershipTiers({
      seller_id: sellerId,
    })) as Array<{ id: string; price_amount: number; interval: string }>
    const priceById = new Map(tiers.map((t) => [t.id, t]))
    let mrr = 0
    for (const m of members) {
      const tier = priceById.get(m.membership_tier_id)
      if (!tier) continue
      const monthly =
        tier.interval === "yearly"
          ? Math.round(Number(tier.price_amount ?? 0) / 12)
          : Number(tier.price_amount ?? 0)
      mrr += monthly
    }
    return mrr
  }

  // ---- Classes --------------------------------------------------------------

  /** A fresh EntityManager for this module's raw conditional updates. */
  private rawManager() {
    return (
      this as unknown as {
        baseRepository_: {
          getFreshManager(): {
            execute(sql: string, params: unknown[], method: "all"): Promise<unknown[]>
          }
        }
      }
    ).baseRepository_.getFreshManager()
  }

  /**
   * Take one seat in a live, future class with room, in one statement:
   * `UPDATE ... WHERE <live> AND ends_at > now() AND <room> RETURNING`.
   * Returns the class's seat count and capacity after the seat was taken, or
   * null when no seat was taken (not live, ended, full, or gone).
   *
   * Raw SQL because the generated `updateClassEvents` reads and then writes,
   * which is the race this closes: two buyers of the last seat both read
   * "room" and both were seated, and a vendor cancel that landed between the
   * read and the write was overwritten with `status: "open"` (SD-52
   * re-review). The column names are this module's own, never input.
   */
  async takeClassSeat(classEventId: string): Promise<{ seats_taken: number; capacity: number } | null> {
    const live = [...LIVE_CLASS_STATUSES]
    const rows = (await this.rawManager().execute(
      `UPDATE wellness_class_event
          SET seats_taken = seats_taken + 1,
              status = CASE WHEN capacity > 0 AND seats_taken + 1 >= capacity THEN 'full' ELSE 'open' END,
              updated_at = now()
        WHERE id = ? AND deleted_at IS NULL
          AND status IN (${live.map(() => "?").join(", ")})
          AND ends_at > now()
          AND (capacity = 0 OR seats_taken < capacity)
        RETURNING seats_taken, capacity`,
      [classEventId, ...live],
      "all"
    )) as Array<{ seats_taken: unknown; capacity: unknown }>
    const row = rows?.[0]
    return row ? { seats_taken: Number(row.seats_taken), capacity: Number(row.capacity) } : null
  }

  /**
   * Give back a seat {@link takeClassSeat} took, when the attendee row that
   * should hold it could not be written. A full class reopens; a class the
   * vendor cancelled meanwhile stays cancelled.
   */
  async releaseClassSeat(classEventId: string): Promise<void> {
    await this.rawManager().execute(
      `UPDATE wellness_class_event
          SET seats_taken = GREATEST(seats_taken - 1, 0),
              status = CASE WHEN status = 'full' THEN 'open' ELSE status END,
              updated_at = now()
        WHERE id = ?`,
      [classEventId],
      "all"
    )
  }

  /**
   * Claim a class's reminder for the start time it now has, in one
   * statement. True for exactly one caller per (class, starts_at): the stamp
   * (`metadata.class_reminder = { starts_at, sent_at }`) is written only if
   * the class holds none for that start time. A class the vendor moves to a
   * new time can be reminded again, for the new time.
   *
   * The hourly reminder job used to remind every attendee on every run in
   * the 24 hours before a class, up to 24 times, out of the seller's shared
   * 50-an-hour send budget; its header claimed a dedupe flag that did not
   * exist (SD-52 re-review).
   */
  async claimClassReminder(classEventId: string, startsAtIso: string): Promise<boolean> {
    const rows = await this.rawManager().execute(
      `UPDATE wellness_class_event
          SET metadata = COALESCE(metadata, '{}'::jsonb)
                || jsonb_build_object('class_reminder', jsonb_build_object('starts_at', CAST(? AS text), 'sent_at', now())),
              updated_at = now()
        WHERE id = ? AND deleted_at IS NULL
          AND (metadata -> 'class_reminder' ->> 'starts_at') IS DISTINCT FROM CAST(? AS text)
        RETURNING id`,
      [startsAtIso, classEventId, startsAtIso],
      "all"
    )
    return Array.isArray(rows) && rows.length === 1
  }

  /** Drop a reminder claim that reached nobody, so the next run tries again. */
  async releaseClassReminder(classEventId: string, startsAtIso: string): Promise<void> {
    await this.rawManager().execute(
      `UPDATE wellness_class_event
          SET metadata = metadata - 'class_reminder', updated_at = now()
        WHERE id = ? AND (metadata -> 'class_reminder' ->> 'starts_at') = CAST(? AS text)`,
      [classEventId, startsAtIso],
      "all"
    )
  }

  /**
   * Register an attendee for a class. Returns the attendee plus whether the
   * class just sold out (so the caller can emit the sold-out KARMA event).
   * Honors capacity → waitlist (when enabled).
   *
   * Refuses a class that is not live or has ended (`refused`, see
   * `classRegistrationRefusal`), writing nothing: no attendee, and the class's
   * status and seat count are left as they are. This is the guard for every
   * caller (the order subscriber and the vendor's manual add); without it a
   * ticket bought for a cancelled or past class reopened the class (`status`
   * below) and seated the buyer (SD-52 review).
   *
   * The seat is taken first, atomically ({@link takeClassSeat}), and the
   * attendee is written only when it was. Before, this read the class,
   * inserted the attendee, then wrote `seats_taken: read + 1` and
   * `status: "open"` back: a vendor cancel landing in between was reopened,
   * and two buyers of the last seat were both seated (SD-52 re-review). If
   * the seat could not be taken the class is read again to say why.
   */
  async registerForClass(input: {
    seller_id: string
    class_event_id: string
    email: string
    name?: string | null
    customer_id?: string | null
    order_id?: string | null
    used_membership_credit?: boolean
  }) {
    const before = (await this.retrieveClassEvent(input.class_event_id)) as Record<string, unknown>
    const refusedBefore = classRegistrationRefusal(before)
    if (refusedBefore) {
      return { attendee: null, sold_out: false, full: false, refused: refusedBefore }
    }

    const attendeeRow = (status: "registered" | "waitlisted") => ({
      seller_id: input.seller_id,
      class_event_id: input.class_event_id,
      customer_id: input.customer_id ?? null,
      customer_email: input.email,
      customer_name: input.name ?? null,
      order_id: input.order_id ?? null,
      status,
      used_membership_credit: input.used_membership_credit ?? false,
    })

    const seat = await this.takeClassSeat(input.class_event_id)
    if (seat) {
      let attendee
      try {
        attendee = await this.createClassAttendees(attendeeRow("registered"))
      } catch (error) {
        await this.releaseClassSeat(input.class_event_id)
        throw error
      }
      const soldOut = seat.capacity > 0 && seat.seats_taken >= seat.capacity
      return { attendee, sold_out: soldOut, full: false, refused: null }
    }

    // No seat: cancelled or ended since the read above, or full.
    const latest = (await this.retrieveClassEvent(input.class_event_id)) as Record<string, unknown>
    const refused = classRegistrationRefusal(latest)
    if (refused) {
      return { attendee: null, sold_out: false, full: false, refused }
    }
    if (!latest.waitlist_enabled) {
      return { attendee: null, sold_out: false, full: true, refused: null }
    }
    const attendee = await this.createClassAttendees(attendeeRow("waitlisted"))
    return { attendee, sold_out: false, full: false, refused: null }
  }

  async markClassAttendance(attendeeId: string, status: string) {
    const patch: Record<string, unknown> = { id: attendeeId, status }
    if (status === "attended") patch.checked_in_at = new Date()
    return this.updateClassAttendees(patch)
  }
}

export default WellnessModuleService
