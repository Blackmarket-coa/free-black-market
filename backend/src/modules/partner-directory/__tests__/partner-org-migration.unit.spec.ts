import type { Configuration } from "@mikro-orm/core"
import type { AbstractSqlDriver } from "@mikro-orm/knex"
import { Migration20261003CreatePartnerOrg } from "../migrations/Migration20261003CreatePartnerOrg"
import { PARTNER_ORG_RELATIONSHIP, PARTNER_ORG_TYPES, PARTNER_ORG_VERIFICATION } from "../org-types"
import PartnerOrg from "../models/partner-org"

/**
 * DB-less shape check on the hand-written migration. The module-integration
 * spec builds its schema from the model, so nothing there reads this file;
 * this is what catches a vocabulary that drifts between `org-types.ts`, the
 * model and the SQL, and a `down()` that stops reversing `up()`.
 */
function queriesOf(run: (m: Migration20261003CreatePartnerOrg) => Promise<void> | void): string {
  const migration = new Migration20261003CreatePartnerOrg(
    undefined as unknown as AbstractSqlDriver,
    undefined as unknown as Configuration
  )
  void run(migration)
  return migration
    .getQueries()
    .map((q) => String(q))
    .join("\n")
}

describe("Migration20261003CreatePartnerOrg", () => {
  const up = queriesOf((m) => m.up())
  const down = queriesOf((m) => m.down())

  it("creates partner_org idempotently with soft-delete columns and a partial unique key index", () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS "partner_org"/)
    for (const col of ["created_at", "updated_at", "deleted_at"]) {
      expect(up).toContain(`"${col}" TIMESTAMPTZ`)
    }
    expect(up).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "IDX_partner_org_key_unique" ON "partner_org" \("key"\) WHERE "deleted_at" IS NULL/)
  })

  it("carries every column the model declares, and nothing shaped like a balance or a contact", () => {
    const modelColumns = Object.keys(PartnerOrg.schema)
    for (const column of modelColumns) {
      expect(up).toContain(`"${column}"`)
    }
    for (const forbidden of ["balance", "accrued", "pending_amount", "contact_name", "contact_email", "contact_phone"]) {
      expect(up.toLowerCase()).not.toContain(forbidden)
    }
  })

  it("CHECK constraints mirror org-types.ts exactly", () => {
    const check = (name: string) => {
      const match = up.match(new RegExp(`"${name}" IN \\(([^)]*)\\)`))
      expect(match).not.toBeNull()
      return match![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""))
    }
    expect(check("org_type")).toEqual([...PARTNER_ORG_TYPES])
    expect(check("verification_status")).toEqual([...PARTNER_ORG_VERIFICATION])
    expect(check("relationship")).toEqual([...PARTNER_ORG_RELATIONSHIP])
  })

  it("defaults match the model: unverified, standalone, unpublished, empty states/serves", () => {
    expect(up).toMatch(/"verification_status" TEXT NOT NULL DEFAULT 'unverified'/)
    expect(up).toMatch(/"relationship" TEXT NOT NULL DEFAULT 'standalone'/)
    expect(up).toMatch(/"published" BOOLEAN NOT NULL DEFAULT false/)
    expect(up).toMatch(/"states" JSONB NOT NULL DEFAULT '\[\]'::jsonb/)
    expect(up).toMatch(/"serves" JSONB NOT NULL DEFAULT '\[\]'::jsonb/)
    expect(up).toMatch(/"stripe_connect_account_id" TEXT NULL/)
  })

  it("down() reverses everything up() created, idempotently", () => {
    expect(down).toMatch(/DROP TABLE IF EXISTS "partner_org"/)
    for (const idx of up.matchAll(/INDEX IF NOT EXISTS "([^"]+)"/g)) {
      expect(down).toContain(`DROP INDEX IF EXISTS "${idx[1]}"`)
    }
    expect(down).not.toMatch(/CREATE/)
  })
})
