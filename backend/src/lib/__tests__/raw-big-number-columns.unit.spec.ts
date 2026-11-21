import { addRawBigNumberColumnsSql, rawDefaultLiteral, type RawCompanion } from "../raw-big-number-columns"

/**
 * The SQL the SD-63 migrations run, by its shape. What it does to a real
 * table is pinned on Postgres (integration-tests/http/
 * module-bignumber-inserts.spec.ts); this keeps the statements themselves
 * from changing unnoticed, since a change here changes migrations that have
 * not run yet on some database. `sd63-migrations-sql.unit.spec.ts` pins every
 * statement of every migration that uses it.
 */
describe("raw-big-number-columns", () => {
  const columns: RawCompanion[] = [
    ["demand_bounty", "amount", "required"],
    ["demand_bounty", "amount_paid_out", { default: "0" }],
    ["demand_post", "target_price", "nullable"],
  ]

  it("adds nullable, backfills, then defaults and guards NOT NULL, one table at a time", () => {
    const sql = addRawBigNumberColumnsSql(columns)
    expect(sql).toHaveLength(6)
    const [add, backfill, defaults, notNull, addPost, backfillPost] = sql

    expect(add).toBe(
      `ALTER TABLE "demand_bounty"\n` +
        `  ADD COLUMN IF NOT EXISTS "raw_amount" JSONB NULL,\n` +
        `  ADD COLUMN IF NOT EXISTS "raw_amount_paid_out" JSONB NULL;`
    )
    // Only a companion that is NULL beside a number is written, in one pass.
    expect(backfill).toContain(
      `"raw_amount" = CASE WHEN "raw_amount" IS NULL AND "amount" IS NOT NULL ` +
        `THEN jsonb_build_object('value', trim_scale("amount"::numeric)::text, 'precision', 20) ELSE "raw_amount" END`
    )
    expect(backfill).toContain(
      ` WHERE ("raw_amount" IS NULL AND "amount" IS NOT NULL)\n` +
        `    OR ("raw_amount_paid_out" IS NULL AND "amount_paid_out" IS NOT NULL);`
    )
    expect(defaults).toBe(
      `ALTER TABLE "demand_bounty"\n  ALTER COLUMN "raw_amount_paid_out" SET DEFAULT '{"value":"0","precision":20}'::jsonb;`
    )
    for (const column of ["raw_amount", "raw_amount_paid_out"]) {
      expect(notNull).toContain(`IF EXISTS (SELECT 1 FROM "demand_bounty" WHERE "${column}" IS NULL) THEN`)
      expect(notNull).toContain(`ALTER TABLE "demand_bounty" ALTER COLUMN "${column}" SET NOT NULL;`)
    }

    // A nullable field gets its column and its backfill, and nothing else.
    expect(addPost).toBe(`ALTER TABLE "demand_post"\n  ADD COLUMN IF NOT EXISTS "raw_target_price" JSONB NULL;`)
    expect(backfillPost).toContain(`UPDATE "demand_post"`)
    expect(sql.join("\n")).not.toContain(`"raw_target_price" SET`)
  })

  it("writes a default as Medusa's raw JSON, and refuses what is not a plain number or identifier", () => {
    expect(rawDefaultLiteral("2")).toBe(`'{"value":"2","precision":20}'::jsonb`)
    expect(() => rawDefaultLiteral("0'); DROP TABLE x; --")).toThrow(/refusing default/)
    expect(() => addRawBigNumberColumnsSql([[`x"; DROP TABLE y; --`, "amount", "required"]])).toThrow(/refusing identifier/)
    expect(() => addRawBigNumberColumnsSql([["demand_post", "Amount", "nullable"]])).toThrow(/refusing identifier/)
  })
})
