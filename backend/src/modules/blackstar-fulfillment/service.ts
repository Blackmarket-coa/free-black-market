import { randomBytes } from "crypto"
import { MedusaService } from "@medusajs/framework/utils"
import { BlackstarBridgeCredential, BlackstarShipment } from "./models"
import { bridgeCredentialCipher } from "./bridge-credential-cipher"

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

class BlackstarFulfillmentModuleService extends MedusaService({
  BlackstarShipment,
  BlackstarBridgeCredential,
}) {
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
