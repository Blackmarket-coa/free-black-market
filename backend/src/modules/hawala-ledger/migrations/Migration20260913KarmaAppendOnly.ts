import { Migration } from "@mikro-orm/migrations"

/**
 * Enforce `karma_event` append-only in the schema, not only by convention
 * (W4-2).
 *
 * `karma.ts` opens by calling the table "append-only by convention (no
 * update/delete path is exposed on the write API)", and that was accurate but
 * thin. `MedusaService` generates `updateKarmaEvents`, `deleteKarmaEvents` and
 * `softDeleteKarmaEvents` on the service whether or not a route calls them, so
 * the guarantee held only as long as nobody typed one — and the whole point of
 * a reputation log is that its history is not editable by the party it
 * flatters. W4 already made each event tamper-*evident* through a per-event
 * attestation; this makes the log tamper-*resistant*, which is the half a hash
 * cannot supply on its own: an attestation tells you a row changed, a
 * constraint stops it changing.
 *
 * The trigger refuses UPDATE and DELETE outright. Verified safe before adding:
 * `service.ts` contains exactly one write, `createKarmaEvents`, and the
 * attestation is built before the insert rather than stamped on afterwards, so
 * there is no legitimate second write to a row. Soft deletion is refused with
 * the rest — a row with `deleted_at` set is a row removed from every default
 * query, which is deletion as far as any reader is concerned.
 *
 * A correction still has a supported shape, and it is the one the model was
 * designed around: append a counter-event with a negative `delta`. The
 * docblock on `KarmaEvent` already says a member's karma at time T is the
 * signed sum of their events, so a reversal is expressible without erasing
 * what it reverses, and the reversal is itself attested and attributable.
 *
 * A future migration that genuinely must rewrite these rows can wrap itself in
 * `ALTER TABLE "karma_event" DISABLE TRIGGER "trg_karma_event_append_only"` and
 * re-enable after — deliberate, visible in review, and recorded in the
 * migration history, which is the difference between a considered exception
 * and an accident.
 */
export class Migration20260913KarmaAppendOnly extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE OR REPLACE FUNCTION "karma_event_append_only"()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION
          'karma_event is append-only: % is not permitted. Append a counter-event with a negative delta instead.',
          TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql;
    `)

    this.addSql(`
      DROP TRIGGER IF EXISTS "trg_karma_event_append_only" ON "karma_event";
    `)

    this.addSql(`
      CREATE TRIGGER "trg_karma_event_append_only"
        BEFORE UPDATE OR DELETE ON "karma_event"
        FOR EACH ROW
        EXECUTE FUNCTION "karma_event_append_only"();
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TRIGGER IF EXISTS "trg_karma_event_append_only" ON "karma_event";
    `)
    this.addSql(`
      DROP FUNCTION IF EXISTS "karma_event_append_only"();
    `)
  }
}
