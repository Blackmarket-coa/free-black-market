import { 
  AbstractNotificationProviderService, 
  MedusaError
} from "@medusajs/framework/utils"
import { 
  ProviderSendNotificationDTO, 
  ProviderSendNotificationResultsDTO,
  Logger
} from "@medusajs/framework/types";
import { 
  CreateEmailOptions, 
  Resend
} from "resend";
import { orderPlacedEmail } from "./emails/order-placed";
import { userInvitedEmail } from "./emails/user-invited";
import { passwordResetEmail } from "./emails/password-reset";
import { vendorAcceptedEmail } from "./emails/vendor-accepted";
import { customerAcceptedEmail } from "./emails/customer-accepted";

enum Templates {
  ORDER_PLACED = "order-placed",
  USER_INVITED = "user-invited",
  PASSWORD_RESET = "password-reset",
  VENDOR_ACCEPTED = "vendor-accepted",
  CUSTOMER_ACCEPTED = "customer-accepted",
}

const templates: {[key in Templates]?: (props: unknown) => React.ReactNode} = {
  [Templates.ORDER_PLACED]: orderPlacedEmail,
  [Templates.USER_INVITED]: userInvitedEmail,
  [Templates.PASSWORD_RESET]: passwordResetEmail,
  [Templates.VENDOR_ACCEPTED]: vendorAcceptedEmail,
  [Templates.CUSTOMER_ACCEPTED]: customerAcceptedEmail,
}

/**
 * Resend error names that indicate a transient failure worth retrying. Anything
 * else (validation errors, unverified domain, bad recipient) is permanent and
 * would fail every attempt, so it is surfaced immediately without retrying.
 */
const TRANSIENT_RESEND_ERROR_NAMES = new Set<string>([
  "rate_limit_exceeded",
  "internal_server_error",
  "application_error",
])

function isTransientResendError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode
  if (
    typeof statusCode === "number" &&
    (statusCode === 429 || statusCode >= 500)
  ) {
    return true
  }
  const name = (error as { name?: unknown }).name
  return typeof name === "string" && TRANSIENT_RESEND_ERROR_NAMES.has(name)
}

// Loosened view of the Resend send result so we can build synthetic outcomes
// (e.g. for a network throw) without fighting the SDK's strict response union.
type EmailSendOutcome = {
  data: { id: string } | null
  error: { name: string; message: string; statusCode?: number | null } | null
}

type ResendOptions = {
  api_key: string
  from: string
  html_templates?: Record<string, {
    subject?: string
    content: string
  }>
  // Bounded exponential-backoff retry for transient send failures. Defaults to
  // 3 attempts / 250ms base when omitted.
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
}

type InjectedDependencies = {
  logger: Logger
}

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"
  private resendClient: Resend
  private options: ResendOptions
  private logger: Logger
  private retryMaxAttempts: number
  private retryBaseDelayMs: number

  constructor(
    { logger }: InjectedDependencies,
    options: ResendOptions
  ) {
    super()
    this.resendClient = new Resend(options.api_key)
    this.options = options
    this.logger = logger
    this.retryMaxAttempts = Math.max(1, options.retry?.maxAttempts ?? 3)
    this.retryBaseDelayMs = Math.max(0, options.retry?.baseDelayMs ?? 250)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Send through Resend, retrying transient failures (network errors, 429s,
   * 5xx) with exponential backoff. Permanent failures and the final attempt's
   * result are returned as-is for the caller to report and throw on.
   */
  private async sendWithRetry(
    emailOptions: CreateEmailOptions,
    to: string
  ): Promise<EmailSendOutcome> {
    let result: EmailSendOutcome = { data: null, error: null }

    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt++) {
      try {
        result = await this.resendClient.emails.send(emailOptions)
      } catch (thrown) {
        // Network / unexpected throw — fold into a transient application error
        // so it flows through the same retry + reporting path as a returned one.
        result = {
          data: null,
          error: {
            name: "application_error",
            message: thrown instanceof Error ? thrown.message : String(thrown),
          },
        }
      }

      if (!result.error && result.data) {
        return result
      }

      const isLastAttempt = attempt >= this.retryMaxAttempts
      if (!isTransientResendError(result.error) || isLastAttempt) {
        return result
      }

      this.logger.warn(
        `Transient email send failure to ${to} (attempt ${attempt}/${this.retryMaxAttempts}); ` +
          `retrying: ${result.error?.message ?? "unknown error"}`
      )
      await this.delay(this.retryBaseDelayMs * 2 ** (attempt - 1))
    }

    return result
  }

  static validateOptions(options: Record<any, any>) {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `api_key` is required in the provider's options."
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `from` is required in the provider's options."
      )
    }
  }


  getTemplate(template: Templates) {
    if (this.options.html_templates?.[template]) {
      return this.options.html_templates[template].content
    }
    const allowedTemplates = Object.keys(templates)

    if (!allowedTemplates.includes(template)) {
      return null
    }

    return templates[template]
  }

  getTemplateSubject(template: Templates) {
    if (this.options.html_templates?.[template]?.subject) {
      return this.options.html_templates[template].subject
    }
    switch(template) {
      case Templates.ORDER_PLACED:
        return "Order Confirmation"
      case Templates.USER_INVITED:
        return "You're Invited!"
      case Templates.PASSWORD_RESET:
        return "Reset Your Password"
      case Templates.VENDOR_ACCEPTED:
        return "Your Free Black Market vendor access is ready"
      case Templates.CUSTOMER_ACCEPTED:
        return "Your account has been approved"
      default:
        return "New Email"
    }
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const template = this.getTemplate(notification.template as Templates)

    if (!template) {
      this.logger.error(`Couldn't find an email template for ${notification.template}. The valid options are ${Object.values(Templates)}`)
      return {}
    }

    const commonOptions = {
      from: this.options.from,
      to: [notification.to],
      subject: this.getTemplateSubject(notification.template as Templates),
    }

    let emailOptions: CreateEmailOptions
    if (typeof template === "string") {
      emailOptions = {
        ...commonOptions,
        html: template,
      }
    } else {
      emailOptions = {
        ...commonOptions,
        react: template(notification.data),
      }
    }

    const { data, error } = await this.sendWithRetry(emailOptions, notification.to)

    if (error || !data) {
      if (error) {
        this.logger.error(`Failed to send email to ${notification.to}:`, error)
        // Log specific error details for common issues
        if (error.message && error.message.includes("verify a domain")) {
          this.logger.error(
            `⚠️  RESEND DOMAIN NOT VERIFIED: You must verify your domain at resend.com/domains ` +
            `or use a verified domain in the RESEND_FROM_EMAIL environment variable.`
          )
        }
      } else {
        this.logger.error(`Failed to send email to ${notification.to}: unknown error`)
      }
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send email: ${error?.message || 'unknown error'}`
      )
    }

    this.logger.info(`Email sent successfully to ${notification.to} (ID: ${data.id})`)
    return { id: data.id }
  }
}

export default ResendNotificationProviderService
