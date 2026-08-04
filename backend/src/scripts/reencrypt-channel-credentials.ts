import { ExecArgs } from "@medusajs/framework/types"
import { CHANNEL_CONNECTOR_MODULE } from "../modules/channel-connector/module-key"
import type ChannelConnectorService from "../modules/channel-connector/service"
import type { ConnectionRow } from "../modules/channel-connector/service"
import { channelCredentialCipher } from "../modules/channel-connector/lib/credentials"

/**
 * Report — and optionally fix — channel access tokens still stored in plaintext.
 *
 * `channel_connection.access_token` is encrypted at rest by the service's write
 * path, and `credential-cipher.ts` reads pre-existing plaintext straight through
 * so deploying that change did not break every live connection at once. That
 * tolerance is what makes the migration safe, and it is also what makes it
 * possible to forget: a row written before the change stays plaintext until
 * something happens to write it again, and nothing in the product forces that.
 * A vendor who connected Faire once and never touched it again keeps a readable
 * marketplace token in the database indefinitely.
 *
 * So this exists to answer "how much is left", which the cipher module already
 * promised by exporting `isEncrypted`, and to finish the job on demand.
 *
 * **Dry run by default.** Rewriting every credential row is not something to do
 * because a command was typed slightly wrong, and the counting half is the part
 * an operator actually wants most of the time.
 *
 *   pnpm medusa exec ./src/scripts/reencrypt-channel-credentials.ts
 *   pnpm medusa exec ./src/scripts/reencrypt-channel-credentials.ts -- --apply
 */
export default async function reencryptChannelCredentials({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve("logger")
  const apply = (args ?? []).includes("--apply")

  const service = container.resolve<ChannelConnectorService>(
    CHANNEL_CONNECTOR_MODULE
  )

  const rows = (await service.listChannelConnections(
    {}
  )) as unknown as ConnectionRow[]

  if (!rows.length) {
    logger.info("[reencrypt-channel-credentials] no channel connections exist")
    return
  }

  const plaintext: ConnectionRow[] = []
  let encrypted = 0
  let empty = 0

  for (const row of rows) {
    const token = row.access_token ?? ""
    if (!token) {
      // A connection with no token cannot be encrypted and is not a finding —
      // it is a broken row, counted separately so it does not read as either
      // "protected" or "still exposed".
      empty++
      continue
    }
    if (channelCredentialCipher.isEncrypted(token)) encrypted++
    else plaintext.push(row)
  }

  logger.info(
    `[reencrypt-channel-credentials] ${rows.length} connections: ` +
      `${encrypted} encrypted, ${plaintext.length} plaintext, ${empty} with no token`
  )

  if (!plaintext.length) {
    logger.info("[reencrypt-channel-credentials] nothing to do")
    return
  }

  // Identifies rows without printing any part of a token. A "first four
  // characters" preview would be a genuinely useful debugging aid and is
  // exactly the kind of thing that ends up in a log aggregator forever.
  for (const row of plaintext) {
    logger.info(
      `[reencrypt-channel-credentials]   plaintext: ${row.seller_id}/${row.channel_id} (${row.id})`
    )
  }

  if (!apply) {
    logger.info(
      "[reencrypt-channel-credentials] dry run — re-run with `-- --apply` to encrypt these in place"
    )
    return
  }

  let converted = 0
  let failed = 0

  for (const row of plaintext) {
    try {
      // Encrypt first, write second. If `encrypt` throws — which it does when
      // no key is configured — the row is left exactly as it was rather than
      // being written with a half-formed value.
      const ciphertext = channelCredentialCipher.encrypt(row.access_token)

      // Deliberately not `upsertConnection`: that clears the throttle state and
      // re-enables a connection the vendor may have paused, and this is a
      // storage migration with no business meaning. Only the one column moves.
      await service.updateChannelConnections({
        id: row.id,
        access_token: ciphertext,
      } as never)
      converted++
    } catch (err) {
      failed++
      logger.error(
        `[reencrypt-channel-credentials] failed for ${row.seller_id}/${row.channel_id}: ` +
          (err instanceof Error ? err.message : "unknown error")
      )
    }
  }

  logger.info(
    `[reencrypt-channel-credentials] encrypted ${converted}/${plaintext.length}` +
      (failed ? `, ${failed} failed` : "")
  )

  if (failed) {
    // Non-zero so a deploy pipeline running this cannot record success while
    // leaving readable tokens behind.
    throw new Error(
      `${failed} channel credential(s) could not be encrypted; see the log above`
    )
  }
}
