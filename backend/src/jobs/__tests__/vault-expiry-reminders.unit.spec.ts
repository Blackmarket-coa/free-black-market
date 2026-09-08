import {
  dueExpiryReminders,
  sentReminderKeys,
} from "../vault-expiry-reminders"
import {
  reminderKey,
  SELLER_REMINDER_TEMPLATES,
} from "../../shared/seller-reminders"

const NOW = new Date("2026-09-08T12:00:00.000Z")
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000)

const doc = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "doc_1",
  seller_id: "sel_1",
  doc_type: "insurance",
  label: "Certificate of insurance",
  expires_at: inDays(7),
  ...over,
}) as never

describe("jobs/vault-expiry-reminders", () => {
  describe("sentReminderKeys", () => {
    it("reads the identity back out of delivered feed rows", () => {
      const keys = sentReminderKeys([
        {
          template: SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING,
          data: { subject_id: "doc_1", stage: 7 },
        },
        {
          template: SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRED,
          data: { subject_id: "doc_2", stage: -1 },
        },
      ])
      expect(keys.has(reminderKey("doc_1", 7))).toBe(true)
      expect(keys.has(reminderKey("doc_2", -1))).toBe(true)
      expect(keys.has(reminderKey("doc_1", 30))).toBe(false)
    })

    it("ignores rows from other producers on the same feed", () => {
      const keys = sentReminderKeys([
        {
          template: SELLER_REMINDER_TEMPLATES.INVOICE_OVERDUE,
          data: { subject_id: "inv_1", stage: 7 },
        },
        { template: "seller_new_order_notification", data: { subject_id: "doc_1", stage: 7 } },
      ])
      // An invoice reminder must not suppress a document reminder that happens
      // to share an id and a stage.
      expect(keys.size).toBe(0)
    })

    it("skips malformed rows rather than throwing", () => {
      const keys = sentReminderKeys([
        { template: null, data: null },
        { template: SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING, data: {} },
        {
          template: SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING,
          data: { subject_id: "doc_1", stage: "not a number" },
        },
      ])
      expect(keys.size).toBe(0)
    })
  })

  describe("dueExpiryReminders", () => {
    it("raises a reminder for a document sitting on a rung", () => {
      const due = dueExpiryReminders([doc()], new Set(), NOW)
      expect(due).toHaveLength(1)
      expect(due[0]).toMatchObject({
        seller_id: "sel_1",
        subject_id: "doc_1",
        stage: 7,
        template: SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING,
      })
      expect(due[0].data).toMatchObject({
        doc_type: "insurance",
        label: "Certificate of insurance",
      })
    })

    it("says nothing about a document that is not on a rung today", () => {
      expect(dueExpiryReminders([doc({ expires_at: inDays(12) })], new Set(), NOW))
        .toHaveLength(0)
    })

    it("does not repeat a reminder that already went out", () => {
      const already = new Set([reminderKey("doc_1", 7)])
      expect(dueExpiryReminders([doc()], already, NOW)).toHaveLength(0)
    })

    it("still sends a different rung for the same document", () => {
      const already = new Set([reminderKey("doc_1", 30)])
      expect(dueExpiryReminders([doc()], already, NOW)).toHaveLength(1)
    })

    it("skips rows with no seller or no id rather than addressing nobody", () => {
      const due = dueExpiryReminders(
        [doc({ seller_id: "" }), doc({ id: "" })],
        new Set(),
        NOW
      )
      expect(due).toHaveLength(0)
    })

    it("keeps each seller's reminder addressed to that seller", () => {
      const due = dueExpiryReminders(
        [doc(), doc({ id: "doc_2", seller_id: "sel_2" })],
        new Set(),
        NOW
      )
      expect(due.map((r) => [r.subject_id, r.seller_id])).toEqual([
        ["doc_1", "sel_1"],
        ["doc_2", "sel_2"],
      ])
    })
  })
})
