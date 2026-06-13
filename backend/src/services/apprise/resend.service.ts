import { createLogger } from "../../shared/logger"
const log = createLogger("services/apprise/resend.service")
/**
 * Resend Email Service
 * 
 * Direct integration with Resend API for sending transactional emails.
 * This can be used standalone or alongside the Apprise notification service.
 * 
 * @see https://resend.com/docs
 */

export interface ResendEmailOptions {
  /** Resend API key */
  apiKey: string
  /** Default from email address */
  fromEmail?: string
  /** Default from name */
  fromName?: string
}

export interface SendEmailParams {
  /** Recipient email address(es) */
  to: string | string[]
  /** Email subject */
  subject: string
  /** HTML content */
  html?: string
  /** Plain text content */
  text?: string
  /** From email (overrides default) */
  from?: string
  /** Reply-to email */
  replyTo?: string
  /** CC recipients */
  cc?: string | string[]
  /** BCC recipients */
  bcc?: string | string[]
  /** Custom headers */
  headers?: Record<string, string>
  /** Tags for analytics */
  tags?: { name: string; value: string }[]
}

export interface ResendResponse {
  id?: string
  success: boolean
  error?: string
}

/**
 * Resend Email Service
 */
export class ResendService {
  private apiKey: string
  private fromEmail: string
  private fromName: string
  private baseUrl = "https://api.resend.com"

  constructor(options: ResendEmailOptions) {
    this.apiKey = options.apiKey || process.env.RESEND_API_KEY || ""
    this.fromEmail = options.fromEmail || process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"
    this.fromName = options.fromName || process.env.RESEND_FROM_NAME || "Ground Up Liberation"
  }

  /**
   * Send an email via Resend API
   */
  async sendEmail(params: SendEmailParams): Promise<ResendResponse> {
    if (!this.apiKey) {
      log.warn("[Resend] No API key configured, email not sent")
      return { success: false, error: "No API key configured" }
    }

    try {
      const from = params.from || `${this.fromName} <${this.fromEmail}>`
      
      const payload: Record<string, any> = {
        from,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
      }

      if (params.html) {
        payload.html = params.html
      }
      if (params.text) {
        payload.text = params.text
      }
      if (params.replyTo) {
        payload.reply_to = params.replyTo
      }
      if (params.cc) {
        payload.cc = Array.isArray(params.cc) ? params.cc : [params.cc]
      }
      if (params.bcc) {
        payload.bcc = Array.isArray(params.bcc) ? params.bcc : [params.bcc]
      }
      if (params.headers) {
        payload.headers = params.headers
      }
      if (params.tags) {
        payload.tags = params.tags
      }

      const response = await fetch(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        log.error("[Resend] API error:", data)
        return { 
          success: false, 
          error: data.message || data.error || "Failed to send email" 
        }
      }

      return { success: true, id: data.id }
    } catch (error) {
      log.error("[Resend] Error sending email:", error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }
    }
  }

  /**
   * Send a delivery notification email
   */
  async sendDeliveryNotification(params: {
    to: string
    customerName: string
    orderNumber: string
    status: "new" | "preparing" | "picked_up" | "delivered" | "issue"
    details?: string
  }): Promise<ResendResponse> {
    const statusEmoji: Record<string, string> = {
      new: "🛒",
      preparing: "👨‍🍳",
      picked_up: "🚴",
      delivered: "✅",
      issue: "⚠️",
    }

    const statusText: Record<string, string> = {
      new: "New Order Received",
      preparing: "Order Being Prepared",
      picked_up: "Order Picked Up - On the Way!",
      delivered: "Order Delivered!",
      issue: "Delivery Issue",
    }

    const emoji = statusEmoji[params.status] || "📦"
    const subject = `${emoji} ${statusText[params.status]} - Order #${params.orderNumber}`

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">${emoji} ${statusText[params.status]}</h1>
          </div>
          
          <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px;">Hi ${params.customerName},</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px; color: #6b7280;">Order Number</p>
              <p style="margin: 5px 0 0; font-size: 20px; font-weight: 600; color: #111827;">#${params.orderNumber}</p>
            </div>
            
            ${params.details ? `<p style="font-size: 15px; color: #4b5563;">${params.details}</p>` : ""}
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
            
            <p style="font-size: 13px; color: #9ca3af; text-align: center; margin: 0;">
              Thank you for supporting local food!<br>
              <strong>Ground Up Liberation Project</strong>
            </p>
          </div>
        </body>
      </html>
    `

    const text = `
${statusText[params.status]}

Hi ${params.customerName},

Order #${params.orderNumber}

${params.details || ""}

Thank you for supporting local food!
Ground Up Liberation Project
    `.trim()

    return this.sendEmail({
      to: params.to,
      subject,
      html,
      text,
    })
  }

  /**
   * Send a driver notification email
   */
  async sendDriverNotification(params: {
    to: string
    driverName: string
    type: "new_delivery" | "assigned" | "reminder"
    orderNumber: string
    pickupAddress?: string
    deliveryAddress?: string
    estimatedPayout?: string
  }): Promise<ResendResponse> {
    const typeEmoji: Record<string, string> = {
      new_delivery: "🚴",
      assigned: "✅",
      reminder: "⏰",
    }

    const typeText: Record<string, string> = {
      new_delivery: "New Delivery Available!",
      assigned: "Delivery Assigned to You",
      reminder: "Delivery Reminder",
    }

    const emoji = typeEmoji[params.type] || "📦"
    const subject = `${emoji} ${typeText[params.type]} - Order #${params.orderNumber}`

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">${emoji} ${typeText[params.type]}</h1>
          </div>
          
          <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px;">Hi ${params.driverName},</p>
            
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 15px; font-size: 14px; color: #6b7280;">Order #${params.orderNumber}</p>
              
              ${params.pickupAddress ? `
                <div style="margin-bottom: 12px;">
                  <p style="margin: 0; font-size: 12px; color: #9ca3af; text-transform: uppercase;">📍 Pickup</p>
                  <p style="margin: 4px 0 0; font-size: 14px; color: #374151;">${params.pickupAddress}</p>
                </div>
              ` : ""}
              
              ${params.deliveryAddress ? `
                <div style="margin-bottom: 12px;">
                  <p style="margin: 0; font-size: 12px; color: #9ca3af; text-transform: uppercase;">📍 Deliver To</p>
                  <p style="margin: 4px 0 0; font-size: 14px; color: #374151;">${params.deliveryAddress}</p>
                </div>
              ` : ""}
              
              ${params.estimatedPayout ? `
                <div>
                  <p style="margin: 0; font-size: 12px; color: #9ca3af; text-transform: uppercase;">💰 Estimated Payout</p>
                  <p style="margin: 4px 0 0; font-size: 18px; font-weight: 600; color: #059669;">${params.estimatedPayout}</p>
                </div>
              ` : ""}
            </div>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;">
            
            <p style="font-size: 13px; color: #9ca3af; text-align: center; margin: 0;">
              <strong>Ground Up Liberation Project</strong>
            </p>
          </div>
        </body>
      </html>
    `

    return this.sendEmail({
      to: params.to,
      subject,
      html,
    })
  }
}

export function createResendService(options?: Partial<ResendEmailOptions>): ResendService {
  return new ResendService({
    apiKey: options?.apiKey || process.env.RESEND_API_KEY || "",
    fromEmail: options?.fromEmail || process.env.RESEND_FROM_EMAIL,
    fromName: options?.fromName || process.env.RESEND_FROM_NAME,
  })
}

export default ResendService
