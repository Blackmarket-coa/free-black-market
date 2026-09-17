import { Migration } from "@mikro-orm/migrations";

/**
 * Add `blackout_checkout_session.amount_cents`.
 *
 * A Blackout checkout session carried only a listing id, so the hosted page
 * priced the cart from the listing's own price. That is right for a fixed-price
 * listing — a subscription tier, a gift, a ticket — but wrong for a coalition
 * drive, where the listing is a destination and the contributor chooses what to
 * give. The card was charged the listing price while Blackout recorded,
 * displayed and metered the amount the contributor picked, and nothing on the
 * return leg compared the two.
 *
 * Nullable, and null keeps the old behaviour, so every existing fixed-price
 * flow is untouched.
 */
export class Migration20260916AddCheckoutSessionAmount extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE IF EXISTS "blackout_checkout_session"
        ADD COLUMN IF NOT EXISTS "amount_cents" INTEGER NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE IF EXISTS "blackout_checkout_session"
        DROP COLUMN IF EXISTS "amount_cents";
    `);
  }
}
