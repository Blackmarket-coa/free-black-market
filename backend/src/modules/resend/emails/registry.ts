import type { EmailTemplateName } from "../templates"
import { orderPlacedEmail } from "./order-placed"
import { userInvitedEmail } from "./user-invited"
import { passwordResetEmail } from "./password-reset"
import { vendorAcceptedEmail } from "./vendor-accepted"
import { customerAcceptedEmail } from "./customer-accepted"
import { bookingConfirmationEmail } from "./booking-confirmation"
import { reviewRequestEmail } from "./review-request"
import { embedChatMessageEmail } from "./embed-chat-message"
import { sellerEmailVerificationEmail } from "./seller-email-verification"
import { digitalOrderEmail } from "./digital-order-template"
import { sellerInvitationEmail } from "./seller-invitation"
import { wholesaleApplicationReceivedEmail } from "./wholesale-application-received"
import { wholesaleApplicationApprovedEmail } from "./wholesale-application-approved"
import { wellnessAutomationEmail } from "./wellness-automation"
import { plantDemandActivatedEmail } from "./plant-demand-activated"

export type EmailTemplateRenderer = (props: unknown) => React.ReactNode

/**
 * The one renderer per template that both `resend` and `smtp` send with.
 *
 * Typed as a full `Record` over `EmailTemplateName`, so adding a name to
 * `../templates.ts` without a renderer here is a compile error in
 * `medusa build`. Each template lives in the file of the same name.
 */
export const EMAIL_TEMPLATE_RENDERERS: Record<EmailTemplateName, EmailTemplateRenderer> = {
  "order-placed": orderPlacedEmail,
  "user-invited": userInvitedEmail,
  "password-reset": passwordResetEmail,
  "vendor-accepted": vendorAcceptedEmail,
  "customer-accepted": customerAcceptedEmail,
  "booking-confirmation": bookingConfirmationEmail,
  "review-request": reviewRequestEmail,
  "embed-chat-message": embedChatMessageEmail,
  "seller-email-verification": sellerEmailVerificationEmail,
  "digital-order-template": digitalOrderEmail,
  "seller-invitation": sellerInvitationEmail,
  "wholesale-application-received": wholesaleApplicationReceivedEmail,
  "wholesale-application-approved": wholesaleApplicationApprovedEmail,
  "wellness-automation": wellnessAutomationEmail,
  "plant-demand-activated": plantDemandActivatedEmail,
}
