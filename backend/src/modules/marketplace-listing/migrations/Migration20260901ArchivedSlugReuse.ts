import { Migration } from "@mikro-orm/migrations"

/**
 * Let an ARCHIVED listing release its slug.
 *
 * `UQ_creator_listing_seller_slug` was unique on (seller_id, slug) for every
 * non-deleted row, which left creators with no way to ship a second version of
 * anything:
 *
 *   - PATCH refuses a PUBLISHED or SUSPENDED listing, advising "bump the
 *     version and create a new draft";
 *   - POST refuses that new draft with `duplicate_slug`, because the published
 *     row still holds the slug;
 *   - DELETE only sets status = 'archived' and never freed it.
 *
 * So the advertised iteration path could not be walked, and the dead end was
 * only discoverable after a first publish. Archiving is the intended "retire
 * this" action, so archiving now frees the slug for reuse by the same seller.
 *
 * Listing identity for entitlements and checkout is the row id, not the slug
 * (`creator_listing.id` is what `providerListingId` carries), so reuse does not
 * re-point anything already sold.
 */
export class Migration20260901ArchivedSlugReuse extends Migration {
  async up(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_creator_listing_seller_slug";`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_creator_listing_seller_slug"
        ON "creator_listing" ("seller_id", "slug")
        WHERE "deleted_at" IS NULL AND "status" <> 'archived';
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "UQ_creator_listing_seller_slug";`)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_creator_listing_seller_slug"
        ON "creator_listing" ("seller_id", "slug")
        WHERE "deleted_at" IS NULL;
    `)
  }
}
