import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const _SALT_LENGTH = 16
const _TAG_LENGTH = 16
const KEY_LENGTH = 32

function getEncryptionKey(): Buffer {
  const key = process.env.WOO_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!key) {
    throw new Error("WOO_ENCRYPTION_KEY or JWT_SECRET must be set for credential encryption")
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
