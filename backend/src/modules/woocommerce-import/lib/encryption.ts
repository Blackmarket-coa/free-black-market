import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"
import { createLogger } from "../../../shared/logger"

const log = createLogger("woocommerce-import/encryption")

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const _SALT_LENGTH = 16
const _TAG_LENGTH = 16
const KEY_LENGTH = 32

let warnedAboutFallback = false

/**
 * Resolve the credential-encryption secret.
 *
 * Prefers a dedicated `WOO_ENCRYPTION_KEY` so a leak of the widely-used
 * `JWT_SECRET` does not also decrypt stored WooCommerce credentials (key
 * separation). The `JWT_SECRET` fallback is retained only so deployments that
 * already encrypted credentials with it can still decrypt — but it warns once,
 * loudly, so operators migrate to a dedicated key.
 */
function getEncryptionKey(): Buffer {
  const dedicated = process.env.WOO_ENCRYPTION_KEY
  const key = dedicated || process.env.JWT_SECRET
  if (!key) {
    throw new Error("WOO_ENCRYPTION_KEY (or, for legacy data, JWT_SECRET) must be set for credential encryption")
  }
  if (!dedicated && !warnedAboutFallback) {
    warnedAboutFallback = true
    log.warn(
      "WOO_ENCRYPTION_KEY is not set; falling back to JWT_SECRET to encrypt vendor store credentials. " +
        "This couples two trust domains — set a dedicated WOO_ENCRYPTION_KEY."
    )
  }
  return scryptSync(key, "woo-import-salt", KEY_LENGTH)
}

export function encrypt(text: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const tag = cipher.getAuthTag()

  // Store as iv:tag:encrypted
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`
}

export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey()
  const parts = encryptedText.split(":")

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format")
  }

  const iv = Buffer.from(parts[0], "hex")
  const tag = Buffer.from(parts[1], "hex")
  const encrypted = parts[2]

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}
