import { Migration } from "@mikro-orm/migrations"

/**
 * Add the `general` archetype to `vendor_type_enum`.
 *
 * `general` is the archetype-neutral vendor type for businesses that do not
 * fit FBM's food-system-specific shapes (producer/garden/kitchen/…). It is the
 * default a vendor lands on when nothing more specific is known.
 *
 * **This migration adds the label and nothing else, deliberately.** MikroORM
 * wraps every migration in a transaction (`Migration.isTransactional()` returns
 * true and nothing in this repo overrides it), and Postgres refuses to *use* an
 * enum label that was added in the still-open transaction:
 *
 *   ERROR: unsafe use of new value "general" of enum type vendor_type_enum
 *   HINT:  New enum values must be committed before they can be used.
 *
 * So setting the column DEFAULT to `general` has to happen in a separate,
 * later migration — see `Migration20260803SetGeneralVendorTypeDefault`. Putting
 * both in one migration rolls the whole thing back and applies neither.
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
