import {
  AbstractNotificationProviderService,
  MedusaError
} from "@medusajs/framework/utils"
import {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
  Logger
} from "@medusajs/framework/types"
import * as nodemailer from "nodemailer"
import { Transporter } from "nodemailer"
import { render } from "@react-email/components"
import {
  EMAIL_TEMPLATE_NAMES,
  EMAIL_TEMPLATE_SUBJECTS,
  isEmailTemplateName,
} from "../resend/templates"
import { EMAIL_TEMPLATE_RENDERERS } from "../resend/emails/registry"

type SMTPOptions = {
  host: string
  port: number
  secure?: boolean
  auth: {
    user: string
    pass: string
  }
  from: string
  html_templates?: Record<string, {
    subject?: string
    content: string
  }>
}

type InjectedDependencies = {
  logger: Logger
}

class SMTPNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-smtp"
  private transporter: Transporter
  private options: SMTPOptions
  private logger: Logger

  constructor(
    { logger }: InjectedDependencies,
    options: SMTPOptions
  ) {
    super()

    // Create Nodemailer transporter
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? (options.port === 465), // true for 465, false for other ports
      auth: {
        user: options.auth.user,
        pass: options.auth.pass,
      },
    })

    this.options = options
    this.logger = logger

    // Verify connection on startup
    this.verifyConnection()
  }

  private async verifyConnection() {
    try {
      await this.transporter.verify()
      this.logger.info("SMTP connection verified successfully")
    } catch (error) {
      this.logger.error("SMTP connection verification failed:", error)
    }
  }

  static validateOptions(options: Record<any, any>) {
    if (!options.host) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `host` is required in the SMTP provider's options."
      )
    }
    if (!options.port) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `port` is required in the SMTP provider's options."
      )
    }
    if (!options.auth?.user) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `auth.user` is required in the SMTP provider's options."
      )
    }
    if (!options.auth?.pass) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `auth.pass` is required in the SMTP provider's options."
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `from` is required in the SMTP provider's options."
      )
    }
  }

  // The template list and renderers are shared with the resend provider
  // (../resend/templates.ts, ../resend/emails/registry.ts): either one may be
  // the `email` channel, so neither may know a template the other does not.
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
      this.logger.error(`Couldn't find an email template for ${notification.template}. The valid options are ${EMAIL_TEMPLATE_NAMES}`)
      return {}
    }

    let html: string

    if (typeof template === "string") {
      html = template
    } else {
      // Render React Email component to HTML string using @react-email/components
      html = await render(template(notification.data) as React.ReactElement)
    }

    const mailOptions = {
      from: this.options.from,
      to: notification.to,
      subject: this.getTemplateSubject(notification.template),
      html: html,
    }

    try {
      const info = await this.transporter.sendMail(mailOptions)

      this.logger.info(`Email sent successfully to ${notification.to} (ID: ${info.messageId})`)

      return { id: info.messageId }
    } catch (error) {
      this.logger.error(`Failed to send email to ${notification.to}:`, error)

      // Provide helpful error messages
      if (error.message && error.message.includes("Invalid login")) {
        this.logger.error(
          `⚠️  SMTP AUTHENTICATION FAILED: Check your SMTP username and password. ` +
          `If using Gmail, you need an "App Password" instead of your regular password.`
        )
      }

      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send email: ${error?.message || 'unknown error'}`
      )
    }
  }
}

export default SMTPNotificationProviderService
