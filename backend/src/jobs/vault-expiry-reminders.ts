import { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { featureFlagState } from "../shared/feature-flags"
import { DOCUMENT_VAULT_MODULE } from "../modules/document-vault"
import type DocumentVaultModuleService from "../modules/document-vault/service"
import {
  buildExpiryReminder,
  deliverSellerReminders,
  reminderKey,
  SELLER_REMINDER_TEMPLATES,
  type ReminderDeliveryResult,
  type SellerReminder,
} from "../shared/seller-reminders"

const log = createLogger("jobs/vault-expiry-reminders")

/** The reminder templates this sweep produces, for the dedupe read. */
const SWEEP_TEMPLATES: readonly string[] = [
  SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRING,
  SELLER_REMINDER_TEMPLATES.DOCUMENT_EXPIRED,
]

type VaultRow = {
  id: string
  seller_id: string
  doc_type: string
  label: string
  expires_at: Date | string | null
}

type SentReminderRow = {
  template?: string | null
  data?: Record<string, unknown> | null
}

/**
 * Which reminders have already gone out.
 *
 * Derived from the notification rows themselves rather than from a marker
 * column on `vault_document`. The feed row *is* the record of having told
 * someone, so reading it back cannot drift from what was actually delivered —
 * whereas a `last_reminded_stage` column can be advanced by a run that then
 * fails to deliver, which is precisely the defect `FBM_AR_DUNNING_LIVE` exists
 * to prevent on the invoice side. It also means this sweep needs no migration.
 */
export function sentReminderKeys(rows: readonly SentReminderRow[]): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    if (!row?.template || !SWEEP_TEMPLATES.includes(row.template)) continue
    const subject = row.data?.subject_id
    const stage = row.data?.stage
    if (typeof subject !== "string") continue
    const stageNum = Number(stage)
    if (!Number.isFinite(stageNum)) continue
    keys.add(reminderKey(subject, stageNum))
  }
  return keys
}

/**
 * The sweep's core, extracted container-free so it can be unit-tested with
 * plain arrays — the `ar-dunning-sweep` pattern, which took it from
 * `demand-pool-expiry`.
 *
 * Returns the reminders that should be sent today and were not sent already.
 */
export function dueExpiryReminders(
  documents: readonly VaultRow[],
  alreadySent: ReadonlySet<string>,
  now: Date
): SellerReminder[] {
  const due: SellerReminder[] = []

  for (const doc of documents) {
    if (!doc?.seller_id || !doc?.id) continue

    const reminder = buildExpiryReminder({
      seller_id: doc.seller_id,
      subject_id: doc.id,
      expires_at: doc.expires_at,
      now,
      data: { doc_type: doc.doc_type, label: doc.label },
    })

    if (!reminder) continue
    if (alreadySent.has(reminderKey(reminder.subject_id, reminder.stage))) continue

    due.push(reminder)
  }

  return due
}

/**
 * Daily: tell vendors which vault documents are about to lapse.
 *
 * `GET /admin/vault?expiring_within=` could already list what was closing in,
 * for an admin. Nothing told the vendor whose certificate it was. This is the
 * vendor-facing half, and the second producer on the shared reminder rail —
 * the first being the `ar.invoice.overdue` subscriber. Both deliver through
 * `shared/seller-reminders.ts` so there is one day-count convention, one dedupe
 * identity and one dry-run switch rather than two of each.
 *
 * Idempotent across a same-day re-run in two independent ways: a rung fires
 * only on the exact day it is reached, and an already-delivered reminder is
 * skipped by `sentReminderKeys`.
 *
 * Best-effort throughout. This job exists to be helpful; it must never be the
 * reason a deploy's scheduled work fails.
 */
export default async function vaultExpiryReminders(
  container: MedusaContainer
): Promise<ReminderDeliveryResult | null> {
  // The vault is opt-in. With it off there are no documents to chase, and
  // resolving the module would throw. Checked before anything else touches the
  // container — the substrate-builder rule.
  if (!featureFlagState.isEnabled("DOCUMENT_VAULT_V1")) {
    return null
  }

  try {
    const vault = container.resolve<DocumentVaultModuleService>(
      DOCUMENT_VAULT_MODULE
    )

    const documents = (await vault.listVaultDocuments({})) as unknown as VaultRow[]
    const withExpiry = (documents ?? []).filter((d) => !!d?.expires_at)

    if (withExpiry.length === 0) return null

    let alreadySent = new Set<string>()
    try {
      const query = container.resolve("query") as {
        graph: (args: Record<string, unknown>) => Promise<{ data: SentReminderRow[] }>
      }
      const { data } = await query.graph({
        entity: "notification",
        fields: ["template", "data"],
        filters: { channel: "seller_feed" },
        pagination: { take: 5000, order: { created_at: "DESC" } },
      })
      alreadySent = sentReminderKeys(data ?? [])
    } catch (err) {
      // Without the dedupe read the safe move is to send nothing: a re-send
      // every day until the document is renewed would train vendors to ignore
      // the drawer, which costs more than a missed day.
      log.error(
        `[vault-expiry] could not read prior reminders; skipping this run`,
        err
      )
      return null
    }

    const due = dueExpiryReminders(withExpiry, alreadySent, new Date())
    const result = await deliverSellerReminders(container, due)

    if (result.considered > 0) {
      log.info(
        `[vault-expiry] considered=${result.considered} delivered=${result.delivered} ` +
          `skipped=${result.skipped} failed=${result.failed} live=${result.live}`
      )
    }

    return result
  } catch (err) {
    log.error(`[vault-expiry-reminders] sweep failed`, err)
    return null
  }
}

export const config = {
  name: "vault-expiry-reminders",
  // After `ar-dunning-sweep` (09:00) and `vendor-verification-expiry` (09:15),
  // once the calendar day has turned over in every US timezone, so a document
  // expiring "today" is never called expired early.
  schedule: "30 9 * * *",
}
