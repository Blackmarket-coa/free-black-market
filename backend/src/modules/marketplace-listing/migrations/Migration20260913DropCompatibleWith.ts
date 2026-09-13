import { Migration } from "@mikro-orm/migrations"

/**
 * Drop `creator_listing.compatible_with` (W3-3).
 *
 * Added by `Migration20260506300AddPluginThemeFields` as a compatibility map —
 * `{ blackout: ">=1.0", fbm: ">=2.12" }` — and never read. A repository-wide
 * search finds the column in exactly three places: the migration that created
 * it, the model that declares it, and the ORM snapshots that mirror the model.
 * No route selects it, no workflow writes it, no panel renders it, and nothing
 * enforces a version constraint from it.
 *
 * It is superseded rather than merely unused. Compatibility belongs in the
 * signed `manifest`, which is covered by `manifestHash` in
 * `CreatorListingSignatureEnvelope` and so cannot be altered after signing. A
 * second, unsigned copy of the same claim on a plain column is worse than no
 * copy: whichever a future reader trusts, the other can disagree with it, and
 * the unsigned one is the one an attacker can change.
 *
 * Dropped rather than left in place because a nullable dead column reads as a
 * feature that exists. The `down` restores the column but not its contents —
 * nothing wrote any, so there is nothing to restore.
 */
export class Migration20260913DropCompatibleWith extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE IF EXISTS "creator_listing"
        DROP COLUMN IF EXISTS "compatible_with";
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE IF EXISTS "creator_listing"
        ADD COLUMN IF NOT EXISTS "compatible_with" JSONB NULL;
    `)
  }
}
