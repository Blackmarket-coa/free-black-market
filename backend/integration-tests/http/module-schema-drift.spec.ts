import { readdirSync, existsSync } from "node:fs"
import path from "node:path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.setTimeout(300 * 1000)

/**
 * Model / migration drift across every FBM module, on a database built from
 * the migrations exactly as production's is.
 *
 * A model column that no migration created is invisible to every other check
 * FBM runs: `medusa build` and `tsc` type the model, unit specs shadow the
 * writes, and module test runners build their schema FROM the models. It
 * surfaces only when a real insert runs on a migrated database, which is how
 * SD-39's breakdown columns, SD-42's hawala tables, `order_attribution`,
 * SD-50's `character_sheet.raw_*` and the vendor-hype `hype_profile.raw_*`
 * columns were each found — one module at a time. `hawala-schema-drift.spec.ts`
 * walks the hawala ledger; this walks every other module under src/modules.
 *
 * KNOWN_DRIFT (columns the model writes and the table lacks) and
 * KNOWN_NOT_NULL_DRIFT (columns the model writes NULL into and the table
 * refuses it) are the drift that exists today, exactly: a table that drifts
 * further, a new model with a missing column, or a fix that is not reflected
 * here all fail. A ratchet — shrink it when a table is fixed; never grow it
 * to make a new model pass.
 */
// Measured 2026-11-15 (SD-63): 38 tables, 94 columns, every one the raw_*
// JSONB companion Medusa writes for a bigNumber field. A missing companion
// makes every insert into that table fail on a migrated database (SD-50 proved
// it for character_sheet), so each line here is a write path that cannot work
// on a database built from the migrations.
// Shrunk by SD-69 (garden's Migration20261115AddRawBigNumberColumns):
// garden_membership, garden_plot and garden_soil_zone are whole again, leaving
// 35 tables and 87 columns in 13 modules.
// Shrunk by the SD-63 migrations (Migration20261117*RawBigNumberColumns, one
// per module, 2026-11-17): 34 tables and 85 columns in 12 modules are whole
// again. character_sheet is left to SD-50's own migration
// (Migration20261115AddCharacterSheetRawBigNumberColumns, branch
// fix/p0-sd50-progression-columns): adding its columns turns XP accrual on,
// and that branch also fixes the order-XP scale the accrual would use, so its
// timing is the operator's call (SD-50).
const KNOWN_DRIFT: Record<string, string[]> = {
  character_sheet: ["raw_capital_deployed_cents", "raw_food_produced_cents"],
}

// A column the model declares nullable with no default, but the migrated
// table holds NOT NULL. Medusa writes NULL for such a field whenever the
// caller gives none (its DML's before-create hook), so every such insert
// fails however the column is defaulted. Measured 2026-11-17: only
// demand_bounty.milestones (SD-134 (5)), fixed by
// Migration20261117DemandBountyMilestonesNullable. Empty, and a ratchet like
// KNOWN_DRIFT: never grow it to make a new model pass.
const KNOWN_NOT_NULL_DRIFT: string[] = []

// Walked by its own ratchet, hawala-schema-drift.spec.ts (SD-42).
const EXCLUDED_MODULES = new Set(["hawala-ledger"])

type ParsedProperty = {
  type?: string
  dataType?: { name?: string }
  nullable?: boolean
  defaultValue?: unknown
  computed?: boolean
}
type DmlModel = {
  schema: Record<string, { parse?: (name: string) => ParsedProperty }>
  parse: () => { tableName: string }
}

const MODULES_DIR = path.resolve(__dirname, "../../src/modules")

function dmlModels(): { module: string; model: DmlModel }[] {
  const out: { module: string; model: DmlModel }[] = []
  for (const mod of readdirSync(MODULES_DIR).sort()) {
    if (EXCLUDED_MODULES.has(mod)) continue
    const index = path.join(MODULES_DIR, mod, "models", "index.ts")
    if (!existsSync(index)) continue
    const exported = require(index) as Record<string, unknown>
    for (const value of Object.values(exported)) {
      const model = value as DmlModel
      if (model && typeof model === "object" && model.schema && typeof model.parse === "function") {
        out.push({ module: mod, model })
      }
    }
  }
  return out
}

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    it("every module model's columns exist on the migrated database, and take what the model writes, except the recorded drift", async () => {
      const pg = (getContainer() as {
        resolve: (k: string) => {
          raw: (q: string, b?: unknown[]) => Promise<{ rows: Array<{ column_name: string; is_nullable: string }> }>
        }
      }).resolve(ContainerRegistrationKeys.PG_CONNECTION)

      const models = dmlModels()
      // Not a silent cap: if discovery breaks, this fails instead of passing on nothing.
      expect(models.length).toBeGreaterThan(150)

      const drift: Record<string, string[]> = {}
      const notNullDrift: string[] = []
      for (const { model } of models) {
        const table = model.parse().tableName
        const nullable = new Map(
          (
            await pg.raw(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = ?`, [table])
          ).rows.map((r) => [r.column_name, r.is_nullable === "YES"])
        )
        const cols = new Set(nullable.keys())
        const missing: string[] = []
        if (cols.size === 0) {
          missing.push("<table>")
        } else {
          for (const [prop, def] of Object.entries(model.schema)) {
            const parsed = def?.parse?.(prop)
            if (!parsed) continue
            if (["hasOne", "hasMany", "manyToMany"].includes(String(parsed.type))) continue
            if (parsed.type === "belongsTo") {
              // Medusa snake-cases the foreign key (digitalProduct -> digital_product_id).
              const fk = `${prop.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}_id`
              if (!cols.has(fk) && !cols.has(`${prop}_id`)) missing.push(fk)
              continue
            }
            if (!cols.has(prop)) missing.push(prop)
            else if (parsed.nullable && parsed.defaultValue === undefined && !parsed.computed && !nullable.get(prop)) {
              notNullDrift.push(`${table}.${prop}`)
            }
            if (parsed.dataType?.name === "bigNumber" && !cols.has(`raw_${prop}`)) missing.push(`raw_${prop}`)
          }
          for (const c of ["created_at", "updated_at", "deleted_at"]) if (!cols.has(c)) missing.push(c)
        }
        if (missing.length > 0) drift[table] = [...new Set(missing)]
      }

      const sorted = (r: Record<string, string[]>) =>
        Object.fromEntries(Object.keys(r).sort().map((k) => [k, [...r[k]].sort()]))
      if (JSON.stringify(sorted(drift)) !== JSON.stringify(sorted(KNOWN_DRIFT))) {
        console.log("MODULE_SCHEMA_DRIFT " + JSON.stringify(sorted(drift)))
      }
      if (JSON.stringify([...notNullDrift].sort()) !== JSON.stringify([...KNOWN_NOT_NULL_DRIFT].sort())) {
        console.log("MODULE_NOT_NULL_DRIFT " + JSON.stringify([...notNullDrift].sort()))
      }
      expect(sorted(drift)).toEqual(sorted(KNOWN_DRIFT))
      expect([...notNullDrift].sort()).toEqual([...KNOWN_NOT_NULL_DRIFT].sort())
    })
  },
})
