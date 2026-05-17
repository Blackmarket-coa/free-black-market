import { Migration } from "@mikro-orm/migrations"

export class Migration20260801CreateWorkVerification extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "proof_artifact_kind_enum" AS ENUM (
          'photo', 'video', 'document', 'shipping_label', 'tracking_event',
          'iot_sensor_log', 'signed_manifest', 'third_party_attestation',
          'onchain_receipt'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "proof_verification_status_enum" AS ENUM (
          'unverified', 'auto_verified', 'manually_verified',
          'disputed', 'rejected'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE "proof_context_type_enum" AS ENUM (
          'service_contract', 'service_milestone', 'order_subcontract',
          'creator_post', 'harvest_batch', 'pick_pack_batch'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "proof_artifact" (
        "id" TEXT NOT NULL,
        "owner_seller_id" TEXT NOT NULL,
        "context_type" proof_context_type_enum NOT NULL,
        "context_id" TEXT NOT NULL,
        "context_secondary_id" TEXT NULL,
        "kind" proof_artifact_kind_enum NOT NULL,
        "storage_url" TEXT NULL,
        "storage_provider" TEXT NULL,
        "sha256" TEXT NULL,
        "captured_at" TIMESTAMPTZ NULL,
        "signature_envelope" JSONB NULL,
        "verification_status" proof_verification_status_enum NOT NULL DEFAULT 'unverified',
        "verification_method" TEXT NULL,
        "verifier_id" TEXT NULL,
        "verified_at" TIMESTAMPTZ NULL,
        "rejection_reason" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "proof_artifact_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_proof_artifact_owner" ON "proof_artifact" ("owner_seller_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_proof_artifact_context" ON "proof_artifact" ("context_type", "context_id");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_proof_artifact_status" ON "proof_artifact" ("verification_status");`)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "proof_artifact" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "proof_context_type_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "proof_verification_status_enum" CASCADE;')
    this.addSql('DROP TYPE IF EXISTS "proof_artifact_kind_enum" CASCADE;')
  }
}
