import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Migration: W4 karma attestation column.
 *
 * `attestation` carries the per-event tamper-evidence record written by the
 * canonical write path (`recordKarmaEvent`): a hash of the identifying
 * fields always, plus an Ed25519 signature under the marketplace signing key
 * when one is configured. Nullable — legacy rows and key-less deployments
 * simply carry null. Additive only.
 */
export class Migration20260830AddKarmaAttestation extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "karma_event" ADD COLUMN IF NOT EXISTS "attestation" jsonb NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "karma_event" DROP COLUMN IF EXISTS "attestation";`
    )
  }
}
