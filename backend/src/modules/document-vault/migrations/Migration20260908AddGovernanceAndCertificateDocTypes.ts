import { Migration } from "@mikro-orm/migrations"

/**
 * Three vault document types the quests already ask for by name.
 *
 * `docs/CDFI_COOP_ROADMAP.md` Tier B item 11 (§3.4, §3.6). Until now a
 * vendor uploaded bylaws as a `contract` and an organic or weights-and-
 * measures certificate as a `credential`, so no predicate could tell a
 * governing document from a supplier contract.
 *
 * No `DO $$ … EXCEPTION` wrapper, following the newest precedent in this
 * repo (`seller-extension/Migration20260802AddGeneralVendorType`) rather
 * than the older ones: `ADD VALUE IF NOT EXISTS` is already idempotent, and
 * the wrapper's `EXCEPTION` arm swallows real failures — a broken `ALTER
 * TYPE` would report success and leave the enum missing a label the
 * TypeScript enum believes exists.
 *
 * `down()` is a no-op by design: PostgreSQL cannot drop a single enum value
 * without rebuilding the type, and these additions are backward-compatible.
 */
export class Migration20260908AddGovernanceAndCertificateDocTypes extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TYPE "vault_document_type_enum" ADD VALUE IF NOT EXISTS 'governing_document';`
    )
    this.addSql(
      `ALTER TYPE "vault_document_type_enum" ADD VALUE IF NOT EXISTS 'organic_certification';`
    )
    this.addSql(
      `ALTER TYPE "vault_document_type_enum" ADD VALUE IF NOT EXISTS 'device_certificate';`
    )
  }

  async down(): Promise<void> {}
}
