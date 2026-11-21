import { createHash } from "node:crypto"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

/**
 * What each SD-63 migration runs, pinned.
 *
 * Twelve of them build their SQL through one shared module
 * (`lib/raw-big-number-columns.ts`), so an edit there would change what a
 * migration does on every database that has not run it yet, and leave it
 * different from what the databases that have run it got. Each entry is the
 * SHA-256 of the statements the migration's `up()` emits, in order. A hash
 * that changes means a migration changed: if that is intended and it has not
 * shipped, update the hash; if it has shipped, write a new migration instead.
 *
 * `down()` emits nothing, for all thirteen: none can tell a column it changed
 * from one the schema already had (each migration says so).
 */
const UP_SHA256: Record<string, string> = {
  Migration20261117BargainingRawBigNumberColumns: "e6b51a1ed0e383bc67d1c245ae3a1b5d17c5ff2ba64c72365a4e62b86c0a71a8",
  Migration20261117BuyerNetworkRawBigNumberColumns: "e3c58317aa1b9daf9b819ea7f767994b7ebee6844707301a7529ae311e798d25",
  Migration20261117CollectiveCampaignRawBigNumberColumns: "0ec159412ff50844caa2810c2c8402978079903751b4e86403779f6c177f6f19",
  Migration20261117CreatorProgramRawBigNumberColumns: "938f337cda71874da230b9b640b72e702d6f43b2a1d2dad8218ac6ba706a0e24",
  Migration20261117CreatorRewardsRawBigNumberColumns: "3ec560f44f75f13d324e920d1fdea4baf560fab98b52820a23084e305763d417",
  Migration20261117DemandBountyMilestonesNullable: "71403b4698ee9cc29416ef93cc8b005ca0d54fa1053ce78b819b1569eaf69126",
  Migration20261117DemandPoolRawBigNumberColumns: "94b90fd7ebd79c7a8d7e709a74e7a009b61abab1c8aff5bc30fc1f364fea1dc6",
  Migration20261117DonationRawBigNumberColumns: "6abee187938edd4b48b2eaeeefc9a5465e3fafac28fc831dcb579ae89f28b0e6",
  Migration20261117KitchenRawBigNumberColumns: "890851a1c36d7d982641edb91c1e54e6a9749dfdeca9a545f40c443bb20f4c76",
  Migration20261117OrderCycleRawBigNumberColumns: "6cebde18f4a74dac525c49b5de719b1ce0beca895bc5fd847825d7ff991d3900",
  Migration20261117OrderSubcontractRawBigNumberColumns: "acbeaf08540f0f06f05c4925431c90dc81c9109c72fc762d51e1e01694bff067",
  Migration20261117ServiceProgramRawBigNumberColumns: "52030626f266052de57b3b55e8b9f2cb7f3d1ce616340cdd89ecc16cc3c8eb6f",
  Migration20261117VendorHypeRawBigNumberColumns: "996bb8f371a658a63737fcf6ba27a0355e7198d4f18e05ec6c6cc38c2a7da6ce",
}

const MODULES_DIR = path.resolve(__dirname, "../../modules")

type MigrationInstance = { up: () => Promise<void>; down: () => Promise<void>; getQueries: () => unknown[] }
type MigrationClass = new (driver: never, config: never) => MigrationInstance

function migrationClass(name: string): MigrationClass {
  const files = readdirSync(MODULES_DIR)
    .map((mod) => path.join(MODULES_DIR, mod, "migrations", `${name}.ts`))
    .filter((file) => existsSync(file))
  // One file, in one module: mikro_orm_migrations is keyed by name alone.
  expect(files).toHaveLength(1)
  return (require(files[0]) as Record<string, MigrationClass>)[name]
}

async function emitted(name: string, direction: "up" | "down"): Promise<string[]> {
  const migration = new (migrationClass(name))({} as never, {} as never)
  await migration[direction]()
  return migration.getQueries().map((query) => {
    expect(typeof query).toBe("string")
    return query as string
  })
}

describe("SD-63 migrations", () => {
  it.each(Object.keys(UP_SHA256))("%s runs the statements it was reviewed with", async (name) => {
    const statements = await emitted(name, "up")
    expect(statements.length).toBeGreaterThan(0)
    const sha = createHash("sha256").update(JSON.stringify(statements)).digest("hex")
    expect({ [name]: sha }).toEqual({ [name]: UP_SHA256[name] })
  })

  it.each(Object.keys(UP_SHA256))("%s takes nothing back in down()", async (name) => {
    expect(await emitted(name, "down")).toEqual([])
  })
})
