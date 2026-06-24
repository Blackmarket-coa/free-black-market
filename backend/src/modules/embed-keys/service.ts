import { MedusaService } from "@medusajs/framework/utils"
import crypto from "crypto"
import VendorEmbedKey from "./models/vendor-embed-key"

export const EMBED_KEY_PREFIX = "pk_live_"

/** Hash a plaintext key into the form we persist and look up by. */
export function hashEmbedKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex")
}

export type GeneratedEmbedKey = {
  id: string
  /** Plaintext key — returned ONCE, never persisted. */
  key: string
  last_four: string
  label: string | null
  created_at: Date
}

export type EmbedKeyResolution = {
  id: string
  seller_id: string
}

class EmbedKeysService extends MedusaService({
  VendorEmbedKey,
}) {
  /**
   * Generate a new publishable key for a seller.
   *
   * Returns the plaintext key exactly once; only its hash is stored. The
   * plaintext is `pk_live_` + 32 url-safe random characters.
   */
  async generateKey(
    seller_id: string,
    label?: string | null
  ): Promise<GeneratedEmbedKey> {
    const random = crypto.randomBytes(24).toString("base64url").slice(0, 32)
    const plaintext = `${EMBED_KEY_PREFIX}${random}`
    const key_hash = hashEmbedKey(plaintext)
    const last_four = plaintext.slice(-4)

    const created = await this.createVendorEmbedKeys({
      seller_id,
      key_hash,
      last_four,
      label: label ?? null,
    })

    return {
      id: created.id,
      key: plaintext,
      last_four,
      label: created.label ?? null,
      created_at: created.created_at as unknown as Date,
    }
  }

  /**
   * Resolve a plaintext key to its owning seller, or null when the key is
   * unknown or revoked. Updates `last_used_at` fire-and-forget.
   */
  async verifyKey(plaintext: string): Promise<EmbedKeyResolution | null> {
    if (!plaintext || !plaintext.startsWith(EMBED_KEY_PREFIX)) {
      return null
    }

    const key_hash = hashEmbedKey(plaintext)
    const rows = await this.listVendorEmbedKeys(
      { key_hash },
      { take: 1 }
    )
    const row = rows?.[0]
    if (!row || row.revoked_at) {
      return null
    }

    // Best-effort "last seen" — never block the request on this write.
    this.updateVendorEmbedKeys({ id: row.id, last_used_at: new Date() }).catch(
      () => {}
    )

    return { id: row.id, seller_id: row.seller_id }
  }

  /** Soft-revoke a key. Returns false when the key does not belong to seller. */
  async revokeKey(id: string, seller_id: string): Promise<boolean> {
    const rows = await this.listVendorEmbedKeys({ id, seller_id }, { take: 1 })
    if (!rows?.length) {
      return false
    }
    await this.updateVendorEmbedKeys({ id, revoked_at: new Date() })
    return true
  }
}

export default EmbedKeysService
