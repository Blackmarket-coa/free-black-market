import * as fs from "fs"
import * as path from "path"
import seedPartnerGulp, {
  GULP_PARTNER_KEY,
  GULP_PARTNER_NAME,
  GULP_SEED_RECORD,
  GULP_UNVERIFIED_NOTICE,
} from "../seed-partner-gulp"
import { PARTNER_DIRECTORY_MODULE, PARTNER_ORG_VERIFICATION_FIELDS } from "../../modules/partner-directory"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  makeInMemoryDirectory,
  type InMemoryDirectory,
  type OrgRow,
} from "../../modules/partner-directory/__tests__/in-memory-partner-orgs"

/**
 * The GULP seed is the one place a pilot partner enters the table without an
 * operator typing it in, so what it may and may not write is pinned here:
 *
 * - first run: the exact Decision 4 record, unpublished and unverified;
 * - second run: only `name` (and a null `tagline`) move; nothing the
 *   operator set since — `published`, `verification_*`, `org_type`, `ein`,
 *   Stripe id — is touched;
 * - it is not reachable from deploy-time seeding;
 * - it resolves the module by the imported constant and fails loudly on any
 *   other key, so a mock on a guessed key cannot pass by fallback.
 *
 * The service is the real `PartnerDirectoryModuleService` with its generated
 * CRUD shadowed, so the seed → service → guard path is what runs.
 */

type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }

function makeContainer(dir: InMemoryDirectory, registeredAs: string = PARTNER_DIRECTORY_MODULE) {
  const lines: string[] = []
  const logger: Logger = {
    info: (m) => void lines.push(m),
    warn: (m) => void lines.push(m),
    error: (m) => void lines.push(m),
  }
  const resolved: string[] = []
  const container = {
    resolve: (key: string) => {
      resolved.push(key)
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === registeredAs) return dir.service
      // awilix throws on an unknown key; mirror that so nothing falls back.
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { container, lines, resolved }
}

type ExecArg = Parameters<typeof seedPartnerGulp>[0]
const run = (c: ReturnType<typeof makeContainer>) => seedPartnerGulp({ container: c.container } as unknown as ExecArg)

describe("seed-partner-gulp", () => {
  it("first run creates the Decision 4 record: name only, unverified, unpublished, no jurisdiction, no contact", async () => {
    const dir = makeInMemoryDirectory()
    const c = makeContainer(dir)
    await run(c)

    expect(dir.rows).toHaveLength(1)
    const row = dir.rows[0]
    expect(row).toMatchObject({
      key: "ground_up_liberation_project",
      name: "Ground Up Liberation Project",
      org_type: null,
      ein: null,
      verification_status: "unverified",
      verification_source: null,
      verified_as_of: null,
      verification_checked_at: null,
      relationship: "sponsored_collective",
      fiscal_host_key: null,
      stripe_connect_account_id: null,
      published: false,
      url: null,
      tagline: null,
      states: [],
      serves: [],
    })
    expect(row.published).toBe(false)
    for (const contact of ["contact_name", "contact_email", "contact_phone"]) {
      expect(row).not.toHaveProperty(contact)
    }
    // The constant the script seeds from says the same thing.
    expect(GULP_SEED_RECORD).toMatchObject({ org_type: null, ein: null, published: false, states: [], serves: [] })
    expect(GULP_SEED_RECORD).not.toHaveProperty("verification_status")

    // The write that reached persistence carried no verification column: the
    // service strips them even from the seed.
    expect(dir.calls.create).toHaveLength(1)
    for (const field of PARTNER_ORG_VERIFICATION_FIELDS) {
      expect(dir.calls.create[0]).not.toHaveProperty(field)
    }
    expect(dir.calls.update).toEqual([])
  })

  it("prints the L11 notice verbatim on create", async () => {
    const dir = makeInMemoryDirectory()
    const c = makeContainer(dir)
    await run(c)
    const out = c.lines.join("\n")
    expect(out).toContain("unverified — do not publish until IRS verification (S8) or counsel sign-off for a non-IRS org type")
    expect(out).toContain(GULP_UNVERIFIED_NOTICE)
    expect(out).toContain("published=false")
  })

  it("second run restores only the name and never flips what the operator set since", async () => {
    const dir = makeInMemoryDirectory()
    await run(makeContainer(dir))

    // Operator has since filled the record in and the ingest has verified it.
    const operatorEdits: Partial<OrgRow> = {
      name: "GULP (renamed by mistake)",
      org_type: "irs_501c3",
      ein: "123456789",
      verification_status: "pub78_eligible",
      verification_source: "irs_bulk_file",
      verified_as_of: new Date("2026-09-01T00:00:00Z"),
      verification_checked_at: new Date("2026-09-15T04:00:00Z"),
      fiscal_host_key: null,
      stripe_connect_account_id: "acct_1GULP",
      published: true,
      url: "https://gulp.example",
      tagline: "Operator-written tagline",
      states: ["Lowcountry"],
      serves: ["nonprofit"],
      metadata: { mou_signed: true },
    }
    Object.assign(dir.rows[0], operatorEdits)

    const c = makeContainer(dir)
    await run(c)

    expect(dir.rows).toHaveLength(1)
    expect(dir.calls.create).toHaveLength(1) // still just the first run's
    expect(dir.calls.update).toHaveLength(1)
    expect(dir.calls.update[0]).toEqual({ id: dir.rows[0].id, name: GULP_PARTNER_NAME })

    const { name: _ignored, ...everythingElse } = operatorEdits
    expect(dir.rows[0]).toMatchObject(everythingElse)
    expect(dir.rows[0].name).toBe(GULP_PARTNER_NAME)
    expect(dir.rows[0].published).toBe(true)
    expect(dir.rows[0].verification_status).toBe("pub78_eligible")
    expect(dir.rows[0].stripe_connect_account_id).toBe("acct_1GULP")

    // Verified now, so the unverified notice is not printed.
    expect(c.lines.join("\n")).not.toContain(GULP_UNVERIFIED_NOTICE)
    expect(c.lines.join("\n")).toContain("published=true")
  })

  it("second run with nothing changed writes nothing", async () => {
    const dir = makeInMemoryDirectory()
    await run(makeContainer(dir))
    const c = makeContainer(dir)
    await run(c)
    expect(dir.calls.create).toHaveLength(1)
    expect(dir.calls.update).toEqual([])
    expect(dir.rows[0].published).toBe(false)
    expect(c.lines.join("\n")).toContain("nothing to change")
    // Still unverified, so the notice prints again.
    expect(c.lines.join("\n")).toContain(GULP_UNVERIFIED_NOTICE)
  })

  it("fills a null tagline but never overwrites one the operator wrote", async () => {
    // GULP_SEED_RECORD.tagline is null today, so this exercises the merge
    // rule with a temporary seed value rather than asserting a no-op.
    const dir = makeInMemoryDirectory([{ key: GULP_PARTNER_KEY, name: GULP_PARTNER_NAME, tagline: "Operator's words" }])
    await run(makeContainer(dir))
    expect(dir.rows[0].tagline).toBe("Operator's words")
    expect(dir.calls.update).toEqual([])
  })

  it("resolves the directory by the imported constant and fails loudly on any other key", async () => {
    const dir = makeInMemoryDirectory()
    const c = makeContainer(dir)
    await run(c)
    expect(c.resolved).toContain(PARTNER_DIRECTORY_MODULE)
    expect(c.resolved.filter((k) => k !== ContainerRegistrationKeys.LOGGER)).toEqual([PARTNER_DIRECTORY_MODULE])

    // A container that registers the service under a near-miss key: the seed
    // must throw, not create nothing and report success.
    const wrong = makeContainer(makeInMemoryDirectory(), "partnerDirectoryModuleService")
    await expect(run(wrong)).rejects.toThrow(/Could not resolve/)
  })

  it("is not reachable from deploy-time seeding", () => {
    const scriptsDir = path.resolve(__dirname, "..")
    const seedTs = fs.readFileSync(path.join(scriptsDir, "seed.ts"), "utf8")
    expect(seedTs).not.toContain("seed-partner-gulp")
    expect(seedTs).not.toContain("ground_up_liberation_project")

    // `pnpm seed` (what conditional-seed.js runs) points at seed.ts and only seed.ts.
    const pkg = JSON.parse(fs.readFileSync(path.resolve(scriptsDir, "../../package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.seed).toBe("medusa exec ./src/scripts/seed.ts")
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(`${name}: ${cmd}`).not.toContain("seed-partner-gulp")
    }
    const conditional = fs.readFileSync(path.resolve(scriptsDir, "../../scripts/conditional-seed.js"), "utf8")
    expect(conditional).not.toContain("seed-partner-gulp")
  })
})
