import { Migration } from "@mikro-orm/migrations"

/**
 * Add the `general` archetype to `vendor_type_enum`.
 *
 * `general` is the archetype-neutral vendor type for businesses that do not fit
 * FBM's food-system-specific shapes (producer/garden/kitchen/…). It is the
 * archetype a vendor lands on when nothing more specific is known.
 *
 * ---
 *
 * **This migration adds the label and nothing else. The Postgres column DEFAULT
 * is deliberately NOT changed here, and cannot be.**
 *
 * Postgres refuses to *use* an enum label added in a still-open transaction:
 *
 *   ERROR: unsafe use of new value "general" of enum type vendor_type_enum
 *   HINT:  New enum values must be committed before they can be used.
 *
 * Medusa runs the whole migration batch inside one master transaction
 * (`Migrator.js` wraps the run when `transactional && allOrNothing`), so
 * `ALTER COLUMN … SET DEFAULT 'general'` fails whether it lives in this
 * migration or a separate later one — both are the same transaction. Both
 * arrangements were tried against the real `medusa db:migrate` runner and both
 * fail with the error above.
 *
 * The obvious escape — `isTransactional() === false`, which `MigrationRunner.js`
 * honours by running outside the master transaction — trades the error for its
 * mirror image: on a fresh database the type itself was created by an earlier
 * migration in the same uncommitted batch, so the statement then fails with
 * `type "vendor_type_enum" does not exist`. That was also verified against the
 * real runner.
 *
 * So the column default stays `'producer'` (set by
 * `Migration20260114FixVendorTypeEnum`). That is harmless: the ORM applies the
 * model-level default from `models/seller-metadata.ts` on every create, and all
 * six application insert paths pass `vendor_type` explicitly, so the SQL-level
 * DEFAULT is only reachable by a raw INSERT that omits the column — which
 * nothing in this codebase does. If it ever needs to agree, it has to be a
 * one-line migration shipped in a *later* deploy, once this label is committed.
 *
 * Note this does NOT copy the `DO $$ … EXCEPTION WHEN others THEN null $$`
 * wrapper used by `Migration20260601AddCreatorVendorType`. That wrapper
 * swallows every error, so a failed `ALTER TYPE` would report success and leave
 * the enum silently missing the label while the TS enum believes it exists.
 * `ADD VALUE IF NOT EXISTS` is already idempotent on its own, which is the only
 * thing that wrapper was needed for.
 */
export class Migration20260802AddGeneralVendorType extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TYPE "vendor_type_enum" ADD VALUE IF NOT EXISTS 'general';`
    )
  }

  async down(): Promise<void> {
    // Postgres cannot drop a value from an enum without recreating the type,
    // which would require rewriting every dependent column. `general` is left
    // in place on rollback — the same stance
    // `Migration20260601AddCreatorVendorType` takes for `creator`.
  }
}
