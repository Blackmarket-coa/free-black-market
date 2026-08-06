import { Migration } from "@mikro-orm/migrations"

/**
 * Phase 5 — mutual aid requests and offers.
 *
 * Location is split deliberately: `latitude`/`longitude` are precise enough to
 * route a delivery and describe where a person in need actually is, while
 * `locality` is a coarse label that is the only thing public listings show.
 * See `lib/aid-location.ts` — nothing serialises the precise columns.
 *
 * TEXT + CHECK for the enums rather than native Postgres types, matching what
 * Medusa's `model.enum()` generates. `bounty_status_enum` diverging from that
 * already cost a harness workaround in `milestone-cas.integration.spec.ts`.
 */
export class Migration20260805CreateMutualAid extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "mutual_aid_request" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "requester_id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "category" TEXT NULL,
        "urgency" TEXT NOT NULL DEFAULT 'ROUTINE'
          CHECK ("urgency" IN ('ROUTINE','SOON','URGENT')),
        "status" TEXT NOT NULL DEFAULT 'OPEN'
          CHECK ("status" IN ('OPEN','MATCHED','FULFILLED','WITHDRAWN','EXPIRED')),
        "quantity" INTEGER NULL,
        "unit_of_measure" TEXT NULL,
        "latitude" DOUBLE PRECISION NULL,
        "longitude" DOUBLE PRECISION NULL,
        "locality" TEXT NULL,
        "needed_by" TIMESTAMPTZ NULL,
        "matched_offer_id" TEXT NULL,
        "matched_helper_id" TEXT NULL,
        "matched_at" TIMESTAMPTZ NULL,
        "fulfilled_at" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ NULL
      );
    `)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "mutual_aid_offer" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "offerer_id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "category" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'AVAILABLE'
          CHECK ("status" IN ('AVAILABLE','COMMITTED','SPENT','WITHDRAWN','EXPIRED')),
        "quantity" INTEGER NULL,
        "unit_of_measure" TEXT NULL,
        "latitude" DOUBLE PRECISION NULL,
        "longitude" DOUBLE PRECISION NULL,
        "locality" TEXT NULL,
        "service_radius_km" DOUBLE PRECISION NULL,
        "available_until" TIMESTAMPTZ NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deleted_at" TIMESTAMPTZ NULL
      );
    `)

    for (const [table, cols] of [
      ["mutual_aid_request", ["status", "requester_id", "category", "matched_helper_id"]],
      ["mutual_aid_offer", ["status", "offerer_id", "category"]],
    ] as const) {
      for (const col of cols) {
        this.addSql(
          `CREATE INDEX IF NOT EXISTS "IDX_${table}_${col}" ON "${table}" ("${col}") WHERE "deleted_at" IS NULL;`
        )
      }
    }
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "mutual_aid_offer";')
    this.addSql('DROP TABLE IF EXISTS "mutual_aid_request";')
  }
}
