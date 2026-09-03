import { randomBytes } from "crypto"
import { MedusaService } from "@medusajs/framework/utils"
import {
  BlackstarBridgeCredential,
  BlackstarEventReceipt,
  BlackstarShipment,
} from "./models"
import { bridgeCredentialCipher } from "./bridge-credential-cipher"
import { decideStatusWrite, type StatusDecision } from "./shipment-lifecycle"

export type RecordShipmentInput = {
  order_id: string
  fulfillment_id?: string | null
  fulfillment_node_id?: string | null
  pickup_point_id?: string | null
  vending_machine_id?: string | null
  external_status?: string | null
  metadata?: Record<string, unknown> | null
}

export const BRIDGE_CREDENTIAL_STATUS = {
  ACTIVE: "active",
  REVOKED: "revoked",
} as const

export type IssuedBridgeCredential = {
  id: string
  key_id: string
  /** Plaintext — returned exactly once at issue time, stored encrypted. */
  secret: string
  label: string
}

export type ApplyEventInput = {
  event_id?: string | null
  event_type: string
  source_order_ref: string
  correlation_id?: string | null
  external_status: string
  fulfillment_node_id?: string | null
  metadata?: Record<string, unknown> | null
}

export type ApplyEventResult = {
  /** False when the event was a replay and nothing was re-evaluated. */
  processed: boolean
  decision: StatusDecision
  shipment_id: string | null
  resulting_status: string | null
}

class BlackstarFulfillmentModuleService extends MedusaService({
  BlackstarShipment,
  BlackstarBridgeCredential,
  BlackstarEventReceipt,
}) {
  /**
   * Apply one inbound Blackstar lifecycle event.
   *
   * Two protections the receiver previously had neither of, both of which
   * the bridge's at-least-once delivery makes necessary rather than merely
   * prudent:
   *
   * 1. **Replay is free.** A receipt keyed on Blackstar's stable outbound
   *    `event_id` short-circuits a redelivery before it is evaluated again
   *    (contract §9.4). "Idempotent by construction" held only while every
   *    handler was a blind overwrite; the ordering guard below makes handling
   *    history-dependent, so re-evaluating a replay against a moved-on state
   *    could now reach a different answer.
   *
   * 2. **Events cannot rewind a shipment.** `decideStatusWrite` refuses an
   *    out-of-order or post-terminal status, so a delayed `in_transit` retry
   *    can no longer rewrite a delivered parcel as still travelling.
   *
   * A skipped event is still recorded, with the reason. An event that
   * arrived and was deliberately not applied must be distinguishable from
   * one that was lost, or the next person reconciling a timeline cannot tell
   * the bridge from the bug.
   */
  async applyBlackstarEvent(input: ApplyEventInput): Promise<ApplyEventResult> {
    if (input.event_id) {
      const [seen] = await this.listBlackstarEventReceipts({
        event_id: input.event_id,
      })
      if (seen) {
        return {
          processed: false,
          decision: { apply: false, reason: "same_status" },
          shipment_id: null,
          resulting_status:
            (seen as { resulting_status?: string | null }).resulting_status ?? null,
        }
      }
    }

    // EVERY shipment row on the order, not the first one found.
    //
    // A second Blackstar fulfillment on one order creates a second
    // blackstar_shipment keyed by (order_id, fulfillment_id). Contract v1
    // events carry only `source_order_ref` — there is no per-parcel key on
    // the wire — so the receiver used to match `[0]` and the second row could
    // never receive an event: an orphan that stayed `pending` forever while
    // its parcel was delivered. Until the wire format grows a per-fulfillment
    // listing key (a Blackstar-side change), an order-scoped event is applied
    // to every parcel on that order, which is what it actually asserts.
    const rows = (await this.listBlackstarShipments({
      order_id: input.source_order_ref,
    })) as unknown as {
      id: string
      external_status?: string | null
      metadata?: Record<string, unknown> | null
    }[]

    const targets = rows.length ? rows : [null]
    let firstShipmentId: string | null = null
    let firstDecision: StatusDecision | null = null
    let firstResulting: string | null = null
    const perRow: Record<string, string> = {}

    for (const existing of targets) {
      const decision = decideStatusWrite(existing?.external_status, input.external_status)

      // Metadata is MERGED, not replaced. `recordOrUpdateShipment` swaps the
      // whole blob, which was harmless while every event was applied and
      // fatal once some are skipped: a refused out-of-order event would
      // otherwise stamp `last_event_type: in_transit` onto a shipment reading
      // `delivered`, and the two fields would contradict each other.
      const metadata: Record<string, unknown> = {
        ...((existing?.metadata ?? {}) as Record<string, unknown>),
        ...(input.metadata ?? {}),
      }
      if (decision.apply) {
        metadata.last_applied_event_id = input.event_id ?? null
        metadata.last_applied_event_type = input.event_type
      } else {
        metadata.last_skipped_event_id = input.event_id ?? null
        metadata.last_skipped_event_type = input.event_type
        metadata.last_skipped_reason = decision.reason
      }

      let shipment: { id: string; external_status?: string | null }
      if (existing) {
        const [updated] = await this.updateBlackstarShipments([
          {
            id: existing.id,
            ...(input.fulfillment_node_id
              ? { fulfillment_node_id: input.fulfillment_node_id }
              : {}),
            ...(decision.apply ? { external_status: input.external_status } : {}),
            metadata,
          },
        ])
        shipment = updated as unknown as { id: string; external_status?: string | null }
      } else {
        shipment = (await this.recordOrUpdateShipment({
          order_id: input.source_order_ref,
          fulfillment_node_id: input.fulfillment_node_id ?? null,
          ...(decision.apply ? { external_status: input.external_status } : {}),
          metadata,
        })) as unknown as { id: string; external_status?: string | null }
      }

      perRow[shipment.id] = decision.reason
      if (firstShipmentId === null) {
        firstShipmentId = shipment.id
        firstDecision = decision
        firstResulting = shipment.external_status ?? null
      }
    }

    const decision = firstDecision ?? { apply: false, reason: "unknown_status" as const }

    if (input.event_id) {
      try {
        await this.createBlackstarEventReceipts([
          {
            event_id: input.event_id,
            event_type: input.event_type,
            source_order_ref: input.source_order_ref,
            correlation_id: input.correlation_id ?? null,
            outcome: decision.reason,
            requested_status: input.external_status,
            resulting_status: firstResulting,
            metadata: rows.length > 1 ? { per_shipment: perRow } : null,
          },
        ])
      } catch {
        // A concurrent delivery of the same event won the unique index. The
        // state writes above are idempotent for that case, so losing the race
        // is not an error worth failing the request over.
      }
    }

    return {
      processed: true,
      decision,
      shipment_id: firstShipmentId,
      resulting_status: firstResulting,
    }
  }

  async recordOrUpdateShipment(input: RecordShipmentInput) {
    const where: Record<string, unknown> = { order_id: input.order_id }
    if (input.fulfillment_id) where.fulfillment_id = input.fulfillment_id
    const [existing] = await this.listBlackstarShipments(where)
    if (existing) {
      const [updated] = await this.updateBlackstarShipments([
        {
          id: existing.id,
          fulfillment_id: input.fulfillment_id ?? existing.fulfillment_id,
          fulfillment_node_id: input.fulfillment_node_id ?? existing.fulfillment_node_id,
          pickup_point_id: input.pickup_point_id ?? existing.pickup_point_id,
          vending_machine_id: input.vending_machine_id ?? existing.vending_machine_id,
          external_status: input.external_status ?? existing.external_status,
          metadata: input.metadata ?? existing.metadata,
        },
      ])
      return updated
    }
    const [created] = await this.createBlackstarShipments([
      {
        order_id: input.order_id,
        fulfillment_id: input.fulfillment_id ?? null,
        fulfillment_node_id: input.fulfillment_node_id ?? null,
        pickup_point_id: input.pickup_point_id ?? null,
        vending_machine_id: input.vending_machine_id ?? null,
        external_status: input.external_status ?? null,
        metadata: input.metadata ?? null,
      },
    ])
    return created
  }

  /**
   * Issue a per-partner bridge credential. The secret is generated here,
   * returned in plaintext exactly once, and persisted only in encrypted form
   * — there is no read-back path; re-issue instead.
   */
  async issueBridgeCredential(args: { label: string }): Promise<IssuedBridgeCredential> {
    const secret = randomBytes(32).toString("hex")
    const [created] = await this.createBlackstarBridgeCredentials([
      {
        key_id: `fbk_${randomBytes(10).toString("hex")}`,
        label: args.label,
        secret: bridgeCredentialCipher.encrypt(secret),
        status: BRIDGE_CREDENTIAL_STATUS.ACTIVE,
      },
    ])
    return { id: created.id, key_id: created.key_id, secret, label: created.label }
  }

  /**
   * Overlap-based rotation: issues a fresh credential under the same label
   * and leaves the old one active until it is explicitly revoked, so the
   * sender switches on its own schedule — no flag day.
   */
  async rotateBridgeCredential(keyId: string): Promise<IssuedBridgeCredential> {
    const [existing] = await this.listBlackstarBridgeCredentials({ key_id: keyId })
    if (!existing) {
      throw new Error(`No bridge credential with key id ${keyId}`)
    }
    return this.issueBridgeCredential({ label: existing.label })
  }

  async revokeBridgeCredential(keyId: string): Promise<void> {
    const [existing] = await this.listBlackstarBridgeCredentials({ key_id: keyId })
    if (!existing) {
      throw new Error(`No bridge credential with key id ${keyId}`)
    }
    await this.updateBlackstarBridgeCredentials([
      {
        id: existing.id,
        status: BRIDGE_CREDENTIAL_STATUS.REVOKED,
        revoked_at: new Date(),
      },
    ])
  }

  /**
   * Resolve an active credential's plaintext secret for verification.
   * Unknown, revoked, or undecryptable key ids all resolve to null — the
   * caller answers exactly like a bad signature, so the endpoint never
   * confirms which key ids exist.
   */
  async findActiveBridgeSecret(
    keyId: string
  ): Promise<{ id: string; secret: string } | null> {
    const [credential] = await this.listBlackstarBridgeCredentials({
      key_id: keyId,
      status: BRIDGE_CREDENTIAL_STATUS.ACTIVE,
    })
    if (!credential) return null
    try {
      return { id: credential.id, secret: bridgeCredentialCipher.decrypt(credential.secret) }
    } catch {
      return null
    }
  }

  async touchBridgeCredential(id: string): Promise<void> {
    await this.updateBlackstarBridgeCredentials([{ id, last_used_at: new Date() }])
  }
}

export default BlackstarFulfillmentModuleService
