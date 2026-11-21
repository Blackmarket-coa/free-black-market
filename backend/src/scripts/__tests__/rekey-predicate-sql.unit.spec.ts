import { knex } from "@medusajs/framework/mikro-orm/knex"

import { predicateSql } from "../rekey-member-keyed-store-data"

/**
 * The rekey script embeds index predicates (`pg_get_expr`) and `keepWhen` SQL
 * in `pg.raw` queries. These cases run the result through knex's own pg
 * binding pass (`toSQL().toNative()`), which is what reaches Postgres, rather
 * than comparing strings with the escape this file is checking.
 */
const pg = knex({ client: "pg" })
const native = (predicate: string | null) =>
  pg.raw(`SELECT 1 FROM t WHERE ${predicateSql(predicate)} AND id = ?`, ["x"]).toSQL().toNative()

describe("predicateSql under knex's pg binding pass", () => {
  it("is TRUE for an index with no predicate", () => {
    expect(native(null)).toEqual({ sql: "SELECT 1 FROM t WHERE TRUE AND id = $1", bindings: ["x"] })
  })

  it.each([
    ["the jsonb ? operator", "metadata ? 'tier'"],
    ["?| and ?&", "(tags ?| ARRAY['a']) AND (tags ?& ARRAY['b'])"],
    ["two ? in a row", "a ?? b"],
    ["a backslash that is not before ?", "name LIKE 'a\\_b%' AND path ~ '\\d+'"],
    ["two backslashes, not before ?", "note = 'x\\\\y'"],
    ["a plain predicate", "(deleted_at IS NULL)"],
  ])("sends %s to Postgres unchanged, and the real binding stays $1", (_label, predicate) => {
    expect(native(predicate)).toEqual({
      sql: `SELECT 1 FROM t WHERE (${predicate}) AND id = $1`,
      bindings: ["x"],
    })
  })

  it.each([
    ["one backslash before ?", "name ~ '^a\\?$'"],
    ["two backslashes before ?", "name ~ '^a\\\\?$'"],
    ["a backslash before ?|", "x \\?| ARRAY['a']"],
  ])("refuses %s, which knex cannot send unchanged", (_label, predicate) => {
    expect(() => predicateSql(predicate)).toThrow(/backslash directly before "\?"/)
  })
})
