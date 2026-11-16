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
import {
  EMAIL_TEMPLATE_NAMES,
  EMAIL_TEMPLATE_SUBJECTS,
  isEmailTemplateName,
} from "./templates";
import { EMAIL_TEMPLATE_RENDERERS } from "./emails/registry";
import { isResendTestingDomain } from "../../lib/resend-sender"

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

    if (isResendTestingDomain(options.from)) {
      this.logger.warn(
        `Resend is configured to send from ${options.from}, on resend.dev, Resend's testing domain. ` +
          `Resend's documentation requires a domain you own and have verified (resend.com/domains), ` +
          `so password resets and order emails are not expected to reach customers. ` +
          `Set RESEND_FROM_EMAIL to an address on your verified domain.`
      )
    }
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


  // The template list and renderers are shared with the smtp provider
  // (./templates.ts, ./emails/registry.ts): either one may be the `email`
  // channel, so neither may know a template the other does not.
  getTemplate(template: string) {
    if (this.options.html_templates?.[template]) {
      return this.options.html_templates[template].content
    }
    if (!isEmailTemplateName(template)) {
      return null
    }

    return EMAIL_TEMPLATE_RENDERERS[template]
  }

  getTemplateSubject(template: string) {
    if (this.options.html_templates?.[template]?.subject) {
      return this.options.html_templates[template].subject
    }
    return isEmailTemplateName(template) ? EMAIL_TEMPLATE_SUBJECTS[template] : "New Email"
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const template = this.getTemplate(notification.template)

    if (!template) {
      // Refused, not dropped. This used to log and return `{}`, which Medusa's
      // notification module records as SUCCESS with no external id, so a
      // misspelt or missing template looked delivered and reached nobody.
      // That silent drop is how six templates went unsent for months. A
      // throw makes the row FAILURE and reaches the caller's catch.
      const message =
        `Couldn't find an email template for ${notification.template}. ` +
        `The valid options are ${EMAIL_TEMPLATE_NAMES.join(", ")}`
      this.logger.error(message)
      throw new MedusaError(MedusaError.Types.INVALID_DATA, message)
    }

    const commonOptions = {
      from: this.options.from,
      to: [notification.to],
      subject: this.getTemplateSubject(notification.template),
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
