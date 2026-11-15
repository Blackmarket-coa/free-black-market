/**
 * The email templates both notification providers can send.
 *
 * `resend` and `smtp` are alternatives for the one `email` channel
 * (medusa-config registers whichever is configured, smtp first), so a caller
 * cannot know which of them will receive its `template`. Each used to keep its
 * own closed list, and the lists drifted: smtp had five of resend's nine, and
 * six templates that callers asked for existed in neither. An unknown template
 * is not refused — `send()` logs and returns `{}`, Medusa records the
 * notification as sent, and nobody receives it.
 *
 * So the list lives here, once, and both providers read it. The renderers are
 * in `emails/registry.ts`, typed against this list so a name without a
 * renderer does not compile; `__tests__/email-template-coverage.unit.spec.ts`
 * walks every `createNotifications` caller in `src/` and fails when one asks
 * the `email` channel for a template that is not here.
 *
 * Kept free of `.tsx` imports so callers (and their unit tests) can name a
 * template without loading React.
 */
export const EMAIL_TEMPLATES = {
  ORDER_PLACED: "order-placed",
  USER_INVITED: "user-invited",
  PASSWORD_RESET: "password-reset",
  VENDOR_ACCEPTED: "vendor-accepted",
  CUSTOMER_ACCEPTED: "customer-accepted",
  BOOKING_CONFIRMATION: "booking-confirmation",
  REVIEW_REQUEST: "review-request",
  EMBED_CHAT_MESSAGE: "embed-chat-message",
  SELLER_EMAIL_VERIFICATION: "seller-email-verification",
  DIGITAL_ORDER: "digital-order-template",
  SELLER_INVITATION: "seller-invitation",
  WHOLESALE_APPLICATION_RECEIVED: "wholesale-application-received",
  WHOLESALE_APPLICATION_APPROVED: "wholesale-application-approved",
  WELLNESS_AUTOMATION: "wellness-automation",
  PLANT_DEMAND_ACTIVATED: "plant-demand-activated",
} as const

export type EmailTemplateName = (typeof EMAIL_TEMPLATES)[keyof typeof EMAIL_TEMPLATES]

export const EMAIL_TEMPLATE_NAMES: readonly EmailTemplateName[] = Object.values(EMAIL_TEMPLATES)

export function isEmailTemplateName(value: unknown): value is EmailTemplateName {
  return typeof value === "string" && (EMAIL_TEMPLATE_NAMES as readonly string[]).includes(value)
}

/** Default subject per template; a provider's `html_templates` option can override it. */
export const EMAIL_TEMPLATE_SUBJECTS: Record<EmailTemplateName, string> = {
  "order-placed": "Order Confirmation",
  "user-invited": "You're Invited!",
  "password-reset": "Reset Your Password",
  "vendor-accepted": "Your Free Black Market vendor access is ready",
  "customer-accepted": "Your account has been approved",
  "booking-confirmation": "Your booking is confirmed",
  "review-request": "How was your order? Leave a review",
  "embed-chat-message": "New message from your website",
  "seller-email-verification": "Confirm your email to open your store",
  "digital-order-template": "Your digital order is ready",
  "seller-invitation": "You're invited to sell on Free Black Market",
  "wholesale-application-received": "We received your wholesale application",
  "wholesale-application-approved": "Your wholesale application is approved",
  "wellness-automation": "A message from your practitioner",
  "plant-demand-activated": "A plant you asked for is going into production",
}
