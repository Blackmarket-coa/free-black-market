/**
 * SQL for the `raw_<field>` companions of `model.bigNumber()` fields (SD-63).
 *
 * Medusa's DML stores a bigNumber as two columns: the NUMERIC `<field>` and a
 * JSONB `raw_<field>` holding `{ "value": "<number as text>", "precision": 20 }`,
 * which the generated CRUD writes on every insert. Several hand-written create
 * migrations made only the NUMERIC half, so on a database built from the
 * migrations every insert into those tables failed. The SD-63 migrations add
 * the missing halves through `addRawBigNumberColumnsSql`.
 *
 * The shape is the one Medusa's own migrations give a bigNumber
 * (`createBigNumberProperties` in @medusajs/utils 2.14.2; e.g. the pricing
 * module's `"raw_amount" jsonb not null` and `"raw_min_quantity" jsonb null`,
 * and the generated `"raw_tip" jsonb not null default
 * '{"value":"0","precision":20}'` in food-distribution):
 *
 * - `.nullable()` field          -> `JSONB NULL`
 * - required field               -> `JSONB NOT NULL`
 * - required field `.default(n)` -> `JSONB NOT NULL DEFAULT '{"value":"n","precision":20}'`
 *
 * Steps per table:
 *
 * 1. `ADD COLUMN IF NOT EXISTS ... JSONB NULL`. A schema that already has the
 *    column (built by sync from the models, or fixed by hand) keeps it, with
 *    its values, type, default and constraints as they are.
 * 2. One UPDATE fills every companion that is NULL beside a non-NULL number,
 *    in the format Medusa writes: `trim_scale` drops trailing zeros as the
 *    DML's `trimZeros` does (12.50 -> "12.5"). A row that already carries a
 *    companion is never touched: Medusa's raw value can hold precision the
 *    NUMERIC column lost.
 * 3. Defaults, then NOT NULL, only for required fields, and NOT NULL only
 *    once no companion is NULL. A required field's NUMERIC column is NOT NULL
 *    in every migration that made one, so after step 2 nothing is NULL; on a
 *    schema where that is not so, the column stays nullable and Postgres
 *    raises a NOTICE naming it, instead of failing the deploy.
 *
 * What it does on a schema it was not written for, so nobody reads more into
 * the above than is there:
 *
 * - On a database built from the migrations, and on one whose companions
 *   were made from the models (`jsonb`), it ends with the model's shape.
 * - A companion that already exists as some other type (`json`, `text`)
 *   fails the migration at step 2 (the CASE cannot mix the types). The
 *   module's migrations run in one transaction, so nothing of it is applied;
 *   `medusa db:migrate` stops at that module, and `scripts/railway-start.js`
 *   then starts the server regardless. The operator's pre-flight query
 *   (SD-63's row in docs/AUDIT_DEBT.md) lists every companion with its type
 *   before the deploy.
 * - A companion that already exists keeps whatever is in it. A value that
 *   disagrees with its number is not corrected, and a constraint or default
 *   the column already had is replaced only where step 3 sets one.
 *
 * There is no SQL to take the columns out again. Each migration's `down()`
 * is a no-op: it cannot tell a column it added from one the schema already
 * had, and dropping the second kind would destroy values Medusa wrote. The
 * companions are harmless to code that predates them.
 *
 * This module is part of those migrations. Changing it changes what they run
 * on any database that has not run them yet: write a new helper instead.
 * `src/lib/__tests__/sd63-migrations-sql.unit.spec.ts` holds a hash of every
 * statement each of them emits, so such a change fails there.
 */

/** How the model declares the bigNumber field. */
export type RawCompanionShape = "nullable" | "required" | { default: string }

export type RawCompanion = [table: string, field: string, shape: RawCompanionShape]

const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`raw-big-number-columns: refusing identifier ${JSON.stringify(name)}`)
  }
  return `"${name}"`
}

/** Medusa's raw JSON for a model default, e.g. `'{"value":"0","precision":20}'::jsonb`. */
export function rawDefaultLiteral(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`raw-big-number-columns: refusing default ${JSON.stringify(value)}`)
  }
  return `'${JSON.stringify({ value, precision: 20 })}'::jsonb`
}

function byTable(columns: RawCompanion[]): Map<string, RawCompanion[]> {
  const tables = new Map<string, RawCompanion[]>()
  for (const column of columns) {
    const list = tables.get(column[0]) ?? []
    list.push(column)
    tables.set(column[0], list)
  }
  return tables
}

export function addRawBigNumberColumnsSql(columns: RawCompanion[]): string[] {
  const sql: string[] = []
  for (const [table, list] of byTable(columns)) {
    const t = ident(table)
    const raw = (field: string) => ident(`raw_${field}`)

    sql.push(
      `ALTER TABLE ${t}\n  ` +
        list.map(([, field]) => `ADD COLUMN IF NOT EXISTS ${raw(field)} JSONB NULL`).join(",\n  ") +
        ";"
    )

    const missing = (field: string) => `${raw(field)} IS NULL AND ${ident(field)} IS NOT NULL`
    sql.push(
      `UPDATE ${t}\n   SET ` +
        list
          .map(
            ([, field]) =>
              `${raw(field)} = CASE WHEN ${missing(field)} ` +
              `THEN jsonb_build_object('value', trim_scale(${ident(field)}::numeric)::text, 'precision', 20) ` +
              `ELSE ${raw(field)} END`
          )
          .join(",\n       ") +
        `\n WHERE ` +
        list.map(([, field]) => `(${missing(field)})`).join("\n    OR ") +
        ";"
    )

    const defaults = list.filter(([, , shape]) => typeof shape === "object")
    if (defaults.length > 0) {
      sql.push(
        `ALTER TABLE ${t}\n  ` +
          defaults
            .map(
              ([, field, shape]) =>
                `ALTER COLUMN ${raw(field)} SET DEFAULT ${rawDefaultLiteral((shape as { default: string }).default)}`
            )
            .join(",\n  ") +
          ";"
      )
    }

    const required = list.filter(([, , shape]) => shape !== "nullable")
    if (required.length > 0) {
      sql.push(
        `DO $$\nBEGIN\n` +
          required
            .map(
              ([, field]) =>
                `  IF EXISTS (SELECT 1 FROM ${t} WHERE ${raw(field)} IS NULL) THEN\n` +
                `    RAISE NOTICE 'SD-63: %.% left nullable: rows with no number to derive it from', '${table}', 'raw_${field}';\n` +
                `  ELSE\n` +
                `    ALTER TABLE ${t} ALTER COLUMN ${raw(field)} SET NOT NULL;\n` +
                `  END IF;\n`
            )
            .join("") +
          `END $$;`
      )
    }
  }
  return sql
}
