import { createLogger } from "../../shared/logger"
const log = createLogger("modules/hawala-ledger/audit-logger")
/**
 * Hawala Financial Audit Logger
 * 
 * SECURITY: Logs all financial operations for compliance and fraud investigation.
 * In production, this should be connected to a proper audit logging service.
 */

export type AuditEventType = 
  | "ACCOUNT_CREATED"
  | "ACCOUNT_FROZEN"
  | "ACCOUNT_CLOSED"
  | "TRANSFER_INITIATED"
  | "TRANSFER_COMPLETED"
  | "TRANSFER_FAILED"
  | "DEPOSIT_INITIATED"
  | "DEPOSIT_COMPLETED"
  | "WITHDRAWAL_INITIATED"
  | "WITHDRAWAL_COMPLETED"
  | "PAYOUT_REQUESTED"
  | "PAYOUT_COMPLETED"
  | "ADVANCE_REQUESTED"
  | "ADVANCE_APPROVED"
  | "ADVANCE_REJECTED"
  | "ADVANCE_REPAID"
  | "INVESTMENT_CREATED"
  | "DIVIDEND_DISTRIBUTED"
  | "VENDOR_PAYMENT"
  | "CHARGEBACK_CLAIM"
  | "ADMIN_ACTION"

export interface AuditEvent {
  event_type: AuditEventType
  actor_id: string
  actor_type: "CUSTOMER" | "VENDOR" | "ADMIN" | "SYSTEM"
  resource_type: string
  resource_id: string
  action: string
  details: Record<string, any>
  ip_address?: string
  user_agent?: string
  timestamp: Date
}

/**
 * Log an audit event
 * 
 * In production, this should:
 * 1. Write to an immutable audit log (e.g., append-only database table)
 * 2. Send to a SIEM system (e.g., Datadog, Splunk)
 * 3. Trigger alerts for suspicious patterns
 */
export function logAuditEvent(event: Omit<AuditEvent, "timestamp">) {
  const fullEvent: AuditEvent = {
    ...event,
    timestamp: new Date(),
  }

  // Structured logging for production systems
  log.info(JSON.stringify({
    level: "audit",
    ...fullEvent,
  }))

  // In production, also write to:
  // - Audit table in database
  // - External logging service
  // - Event stream for real-time monitoring
}

/**
 * Helper to create audit events for financial transactions
 */
export function auditFinancialTransaction(
  eventType: AuditEventType,
  actorId: string,
  actorType: AuditEvent["actor_type"],
  transactionId: string,
  amount: number,
  details: Record<string, any> = {}
) {
  logAuditEvent({
    event_type: eventType,
    actor_id: actorId,
    actor_type: actorType,
    resource_type: "TRANSACTION",
    resource_id: transactionId,
    action: eventType.toLowerCase().replace(/_/g, " "),
    details: {
      amount,
      currency: "USD",
      ...details,
    },
  })
}

/**
 * Helper to create audit events for admin actions
 */
export function auditAdminAction(
  adminId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  details: Record<string, any> = {}
) {
  logAuditEvent({
    event_type: "ADMIN_ACTION",
    actor_id: adminId,
    actor_type: "ADMIN",
    resource_type: resourceType,
    resource_id: resourceId,
    action,
    details,
  })
}
