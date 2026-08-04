import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"
import { createLogger } from "./logger"

const log = createLogger("shared/credential-cipher")

/**
 * Encryption at rest for third-party credentials.
 *
 * Phase 12's "per-vendor-per-channel credential management, following the
 * existing import-module pattern". The pattern is real and already in the
 * codebase: `modules/woocommerce-import/lib/encryption.ts` encrypts store URL,
 * consumer key and secret at the write path
 * (`workflows/woocommerce-import/steps/save-woo-connection.ts`) and decrypts
 * only where a request is about to be made; `odoo_connection` does the same for
 * its url/db/username/api_key.
 *
 * `channel_connection.access_token` is the one that does not, and the comment
 * on that model justified it by saying the other connection tables keep
 * plaintext. That was wrong — they encrypt. So the channel connector has been
 * the single connection table holding a live marketplace token in the clear,
 * and this is what closes that.
 *
 * Two things are different from the WooCommerce helper, both because of what
 * this one has to survive that that one never did.
 *
 * **A version prefix, not a shape heuristic.** The Woo helper decides "is this
 * ciphertext" by splitting on `:` and requiring exactly three parts. That works
 * only because nothing ever hands it a plaintext value. Here, every existing
 * row *is* plaintext, and an access token may legitimately contain colons — so
 * a heuristic would either throw on real data or, worse, mangle a token that
 * happened to have two colons in it. `ENC_PREFIX` makes the question a fact
 * rather than a guess.
 *
 * **Legacy plaintext reads through unchanged.** Rows written before this
 * existed must keep working, and there is no migration that can encrypt them:
 * the migration runs in SQL and the key lives in the process environment. So
 * `decrypt` passes through anything without the prefix, and the value is
 * upgraded the next time it is written. That tolerance is a transitional
 * affordance, not a permanent one — it is what makes the deploy non-breaking,
 * and it is equally what makes it easy to forget, because a connection nobody
 * edits stays readable indefinitely.
 *
 * `isEncrypted` is exported for exactly that reason:
 * `scripts/reencrypt-channel-credentials.ts` uses it to report how much
 * plaintext is left and, with `--apply`, to finish the job.
 */

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const KEY_LENGTH = 32

/**
 * Marks a value as ciphertext this module produced.
 *
 * Versioned so a future change of algorithm can be rolled out by reading both
 * and writing one, rather than by a flag day that would have to decrypt every
 * row in one transaction.
 */
export const ENC_PREFIX = "fbmenc.v1."

export type CredentialCipher = {
  /** Encrypt, returning a prefixed, self-describing string. */
  encrypt(plaintext: string): string
  /** Decrypt, passing legacy plaintext through untouched. */
  decrypt(stored: string): string
  /** Whether a stored value has already been encrypted by this module. */
  isEncrypted(stored: string): boolean
}

export type CipherOptions = {
  /**
   * Environment variables holding the key, most-preferred first.
   *
   * A list rather than one name so a key can be rotated without downtime: the
   * first entry encrypts, every entry is tried for decryption. Without that,
   * rotating means every stored credential becomes unreadable at the moment the
   * variable changes — which in practice means the key is never rotated.
   */
  envKeys: readonly string[]
  /**
   * Keys accepted only when none of `envKeys` is set, with a loud one-time
   * warning. Intended for `JWT_SECRET`.
   *
   * This is a deliberate, uncomfortable trade. Fail-closed is the better
   * posture in isolation — but the alternative it produces on an upgrade is a
   * vendor who cannot connect a channel at all, and the pragmatic fix an
   * operator reaches for under that pressure is worse than a shared secret. A
   * fallback that works and complains beats a hard failure that gets worked
   * around, and it is still strictly better than the plaintext column it
   * replaces. It is separated from `envKeys` so the distinction between "the
   * key we asked for" and "the key we settled for" survives in the type, and
   * so the warning can name it.
   */
  fallbackEnvKeys?: readonly string[]
  /** Domain-separating salt. Distinct per credential class. */
  salt: string
  /** Used in errors and warnings so an operator knows which key to set. */
  label: string
}

function readEnv(names: readonly string[]): string[] {
  return names
    .map((name) => process.env[name])
    .filter((v): v is string => Boolean(v && v.trim()))
}

export function createCredentialCipher(
  options: CipherOptions
): CredentialCipher {
  let warnedNoKey = false
  let warnedFallback = false

  /** Derived keys, most-preferred first. Throws when nothing is configured. */
  function resolveKeys(): Buffer[] {
    let secrets = readEnv(options.envKeys)

    if (!secrets.length) {
      secrets = readEnv(options.fallbackEnvKeys ?? [])
      if (secrets.length && !warnedFallback) {
        warnedFallback = true
        log.warn(
          `${options.envKeys[0]} is not set; falling back to ` +
            `${(options.fallbackEnvKeys ?? []).join("/")} to encrypt ` +
            `${options.label} credentials. This couples two trust domains — ` +
            `set a dedicated ${options.envKeys[0]}.`
        )
      }
    }

    if (!secrets.length) {
      throw new Error(
        `${options.envKeys[0]} must be set to store ${options.label} credentials.`
      )
    }

    // Read from the environment on every call rather than cached at module
    // load: a cached key would make rotation require a restart, and would make
    // the warning above fire against whatever the environment looked like when
    // the first import happened rather than when the credential was written.
    return secrets.map((secret) => scryptSync(secret, options.salt, KEY_LENGTH))
  }

  const isEncrypted = (stored: string): boolean =>
    typeof stored === "string" && stored.startsWith(ENC_PREFIX)

  return {
    isEncrypted,

    encrypt(plaintext: string): string {
      // Throws rather than falling back to storing plaintext. A cipher that
      // silently degrades is worse than none: the column would look protected,
      // the operator would stop looking, and nothing would ever say otherwise.
      const [key] = resolveKeys()
      const iv = randomBytes(IV_LENGTH)
      const cipher = createCipheriv(ALGORITHM, key, iv)

      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ])
      const tag = cipher.getAuthTag()

      return `${ENC_PREFIX}${iv.toString("hex")}.${tag.toString(
        "hex"
      )}.${encrypted.toString("hex")}`
    },

    decrypt(stored: string): string {
      if (!isEncrypted(stored)) {
        // Written before this module existed. Returned as-is so a deploy does
        // not break every live connection at once; re-encrypted on next write.
        return stored
      }

      const parts = stored.slice(ENC_PREFIX.length).split(".")
      if (parts.length !== 3) {
        throw new Error(
          `Malformed ${options.label} credential: expected iv.tag.ciphertext.`
        )
      }

      const [ivHex, tagHex, dataHex] = parts

      let keys: Buffer[]
      try {
        keys = resolveKeys()
      } catch (err) {
        if (!warnedNoKey) {
          warnedNoKey = true
          log.error(
            `Cannot decrypt ${options.label} credentials: no key is set. ` +
              `Set ${options.envKeys[0]}.`
          )
        }
        throw err
      }

      // Every configured key is tried, newest first, so the window during which
      // a rotation has happened but old rows have not yet been rewritten does
      // not lock a vendor out of their own channel.
      let lastError: unknown
      for (const key of keys) {
        try {
          const decipher = createDecipheriv(
            ALGORITHM,
            key,
            Buffer.from(ivHex, "hex")
          )
          decipher.setAuthTag(Buffer.from(tagHex, "hex"))
          return Buffer.concat([
            decipher.update(Buffer.from(dataHex, "hex")),
            decipher.final(),
          ]).toString("utf8")
        } catch (err) {
          lastError = err
        }
      }

      // GCM authentication failed against every key. Reported as a key problem
      // rather than as corruption, because that is overwhelmingly what it is —
      // and the remedy (restore the old key, or have the vendor reconnect)
      // depends on knowing that.
      throw new Error(
        `Could not decrypt ${options.label} credential with any configured key` +
          (lastError instanceof Error ? `: ${lastError.message}` : "")
      )
    },
  }
}
