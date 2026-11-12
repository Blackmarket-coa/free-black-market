import { Migration } from "@mikro-orm/migrations"

export class Migration20261112000100AllowAmbiguousShipmentOutcome extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE "blackstar_event_receipt" DROP CONSTRAINT "CK_blackstar_event_receipt_outcome";`)
    this.addSql(`ALTER TABLE "blackstar_event_receipt" ADD CONSTRAINT "CK_blackstar_event_receipt_outcome" CHECK (
      "outcome" IN ('applied', 'first_status', 'same_status', 'out_of_order', 'terminal', 'unknown_status', 'ignored', 'ambiguous_shipment')
    );`)
  }

  async down(): Promise<void> {
    // Preserve the reason in metadata before restoring the old vocabulary.
    this.addSql(`UPDATE "blackstar_event_receipt" SET "outcome" = 'ignored',
      "metadata" = COALESCE("metadata", '{}'::jsonb) || '{"original_outcome":"ambiguous_shipment"}'::jsonb
      WHERE "outcome" = 'ambiguous_shipment';`)
    this.addSql(`ALTER TABLE "blackstar_event_receipt" DROP CONSTRAINT "CK_blackstar_event_receipt_outcome";`)
    this.addSql(`ALTER TABLE "blackstar_event_receipt" ADD CONSTRAINT "CK_blackstar_event_receipt_outcome" CHECK (
      "outcome" IN ('applied', 'first_status', 'same_status', 'out_of_order', 'terminal', 'unknown_status', 'ignored')
    );`)
  }
}
