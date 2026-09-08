import {
  buildExpiryReminder,
  deliverSellerReminders,
  expiryReminderStage,
  EXPIRY_REMINDER_DAYS,
  reminderKey,
  remindersAreLive,
  SELLER_REMINDER_TEMPLATES,
} from "../seller-reminders"
import { classifyNotification } from "../../lib/notification-buckets"

const NOW = new Date("2026-09-08T12:00:00.000Z")
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000)

const FLAG = "FF_SELLER_REMINDERS_V1"

describe("shared/seller-reminders", () => {
  const original = process.env[FLAG]
  afterEach(() => {
    if (original === undefined) delete process.env[FLAG]
    else process.env[FLAG] = original
  })

  describe("the ladder", () => {
    it("fires only on the exact day a rung is reached", () => {
      for (const rung of EXPIRY_REMINDER_DAYS) {
        expect(expiryReminderStage(rung)).toBe(rung)
      }
      for (const quiet of [45, 31, 29, 15, 13, 8, 6, 2]) {
        expect(expiryReminderStage(quiet)).toBeNull()
      }
    })

    it("does not put an already-lapsed document on a rung", () => {
      expect(expiryReminderStage(-1)).toBeNull()
      expect(expiryReminderStage(-30)).toBeNull()
    })
  })

  describe("buildExpiryReminder", () => {
    it("says nothing about a document with no expiry", () => {
      expect(
        buildExpiryReminder({
          seller_id: "sel_1",
          subject_id: "doc_1",
          expires_at: null,
          now: NOW,
        })
      ).toBeNull()
    })

    it("says nothing on a day that is not a rung", () => {
      expect(
        buildExpiryReminder({
          seller_id: "sel_1",
          subject_id: "doc_1",
          expires_at: inDays(12),
          now: NOW,
        })
      ).toBeNull()
    })

    it("raises an expiring reminder on a rung, carrying the stage", () => {
      const r = buildExpiryReminder({
        seller_id: "sel_1",
        subject_id: "doc_1",
        expires_at: inDays(7),
        now: NOW,
      })
      expect(r).not.toBeNull()
      expect(r!.template).toBe(SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING)
      expect(r!.stage).toBe(7)
      expect(r!.data.days_until).toBe(7)
    })

    it("raises a distinct expired reminder once, the day after it lapses", () => {
      const justLapsed = buildExpiryReminder({
        seller_id: "sel_1",
        subject_id: "doc_1",
        expires_at: new Date(NOW.getTime() - 3_600_000), // an hour ago
        now: NOW,
      })
      expect(justLapsed!.template).toBe(SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRED)
      // -1, so it cannot collide with the day-0 rung sent earlier the same day.
      expect(justLapsed!.stage).toBe(-1)
      expect(reminderKey("doc_1", justLapsed!.stage)).not.toBe(reminderKey("doc_1", 0))

      // Long expired: not chased again, ever.
      expect(
        buildExpiryReminder({
          seller_id: "sel_1",
          subject_id: "doc_1",
          expires_at: inDays(-30),
          now: NOW,
        })
      ).toBeNull()
    })

    it("still sends the day-0 rung before it has actually lapsed", () => {
      const laterToday = new Date(NOW.getTime() + 6 * 3_600_000)
      const r = buildExpiryReminder({
        seller_id: "sel_1",
        subject_id: "doc_1",
        expires_at: laterToday,
        now: NOW,
      })
      expect(r!.template).toBe(SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING)
      expect(r!.stage).toBe(0)
    })
  })

  describe("delivery", () => {
    const reminder = {
      seller_id: "sel_1",
      template: SELLER_REMINDER_TEMPLATES.INVOICE_OVERDUE,
      subject_id: "inv_1",
      stage: 7,
      data: {},
    }

    it("sends nothing and records nothing while the flag is off", async () => {
      delete process.env[FLAG]
      expect(remindersAreLive()).toBe(false)

      const createNotifications = jest.fn()
      const container = { resolve: () => ({ createNotifications }) }

      const result = await deliverSellerReminders(container, [reminder])

      expect(createNotifications).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        considered: 1,
        delivered: 0,
        skipped: 1,
        failed: 0,
        live: false,
      })
    })

    it("writes a seller_feed row addressed to the seller when live", async () => {
      process.env[FLAG] = "true"
      const createNotifications = jest.fn().mockResolvedValue({})
      const container = { resolve: () => ({ createNotifications }) }

      const result = await deliverSellerReminders(container, [reminder])

      expect(result).toMatchObject({ delivered: 1, failed: 0, live: true })
      expect(createNotifications).toHaveBeenCalledWith({
        to: "sel_1",
        channel: "seller_feed",
        template: SELLER_REMINDER_TEMPLATES.INVOICE_OVERDUE,
        data: expect.objectContaining({ subject_id: "inv_1", stage: 7 }),
      })
    })

    it("never throws, and one bad row does not abort the batch", async () => {
      process.env[FLAG] = "true"
      const createNotifications = jest
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({})
      const container = { resolve: () => ({ createNotifications }) }

      const result = await deliverSellerReminders(container, [
        reminder,
        { ...reminder, subject_id: "inv_2" },
      ])

      expect(result).toMatchObject({ considered: 2, delivered: 1, failed: 1 })
    })

    it("degrades quietly when no notification module is registered", async () => {
      process.env[FLAG] = "true"
      const container = {
        resolve: () => {
          throw new Error("no such module")
        },
      }

      const result = await deliverSellerReminders(container, [reminder])
      expect(result).toMatchObject({ delivered: 0, skipped: 1, failed: 0 })
    })
  })

  describe("bucket registration", () => {
    it("puts every reminder template in awaits_me, so the badge counts it", () => {
      // A correctly-delivered reminder that lands in about_me never raises the
      // drawer badge, which is the only thing the vendor looks at.
      for (const template of Object.values(SELLER_REMINDER_TEMPLATES)) {
        expect(classifyNotification(template)).toBe("awaits_me")
      }
    })
  })
})
