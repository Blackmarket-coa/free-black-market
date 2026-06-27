import { model } from "@medusajs/framework/utils"

/**
 * Automation Template — an editable, opt-in Blackout (Matrix) message the
 * practitioner sends automatically on FBM events. The body uses bracket
 * variables substituted at send time:
 *   [name] [session_type] [date] [time] [link] [credits] [tier] [available_slots]
 *
 * One template per (seller_id, trigger).
 */
export type AutomationTrigger =
  | "booking_confirmed"
  | "booking_reminder_24h"
  | "booking_reminder_1h"
  | "booking_completed"
  | "no_show"
  | "class_registered"
  | "class_reminder"
  | "recording_available"
  | "membership_welcome"
  | "membership_renewed"
  | "credits_low"
  | "reengagement"

export type AutomationChannel = "matrix" | "email"

const AutomationTemplate = model.define("wellness_automation_template", {
  id: model.id().primaryKey(),

  seller_id: model.text(),

  // One of AutomationTrigger.
  trigger: model.text(),
  name: model.text(),
  body: model.text(),

  // "matrix" | "email"
  channel: model.text().default("matrix"),
  enabled: model.boolean().default(false),

  // For reminder triggers: minutes before the event to fire.
  offset_minutes: model.number().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    {
      on: ["seller_id", "trigger"],
      name: "UQ_wellness_automation_template_seller_trigger",
      unique: true,
    },
  ])

export default AutomationTemplate
