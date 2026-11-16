import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"

/**
 * The pre-deploy env check (`scripts/assert-env.mjs --app=backend`, `pnpm
 * assert-env`) for the Blackstar parcel bridge, run as the real CLI. It is not
 * a boot guard and is not in the backend image; the same rules run at boot in
 * `src/shared/config.ts` (`src/shared/__tests__/config-blackstar-boot.unit.spec.ts`).
 *
 * Its rule used to require `FBM_BLACKSTAR_API_KEY`, which no code reads (it
 * belonged to the retired static-key shipments route). So it passed a deploy
 * that set that one value and none of the secrets the bridge needs, and
 * failed one that set them all but not the dead key.
 */
const SCRIPT = path.resolve(__dirname, "../../../scripts/assert-env.mjs")
const SECRET = (c: string) => c.repeat(40)

const BASE_PRODUCTION_ENV = {
  NODE_ENV: "production",
  JWT_SECRET: SECRET("j"),
  COOKIE_SECRET: SECRET("c"),
  DATABASE_URL: "postgres://u:p@db.example.com:5432/fbm",
  MEDUSA_ADMIN_PASSWORD: SECRET("a"),
  CREATOR_ATTRIBUTION_IP_SALT: SECRET("s"),
}

function gate(extra: Record<string, string>) {
  const run = spawnSync(process.execPath, [SCRIPT, "--app=backend"], {
    env: { PATH: process.env.PATH ?? "", ...BASE_PRODUCTION_ENV, ...extra },
    encoding: "utf8",
  })
  return { code: run.status, out: `${run.stdout}${run.stderr}` }
}

describe("assert-env: the Blackstar bridge's production secrets", () => {
  it("passes a production env with the bridge off", () => {
    const { code, out } = gate({})
    expect(out).toContain("production env OK")
    expect(code).toBe(0)
  })

  it("with the bridge on, requires the outbound destination and both signing secrets", () => {
    const { code, out } = gate({ FBM_BLACKSTAR_INTEGRATION: "1" })
    expect(code).toBe(1)
    expect(out).toContain("BLACKSTAR_API_BASE is required")
    expect(out).toContain("BLACKSTAR_WEBHOOK_SECRET is required")
    expect(out).toContain("BLACKSTAR_OUTBOUND_SECRET is required")
  })

  it("no longer accepts the dead FBM_BLACKSTAR_API_KEY in their place", () => {
    const { code } = gate({ FBM_BLACKSTAR_INTEGRATION: "1", FBM_BLACKSTAR_API_KEY: SECRET("k") })
    expect(code).toBe(1)
  })

  it("passes with the three values the code reads", () => {
    const { code, out } = gate({
      FBM_BLACKSTAR_INTEGRATION: "1",
      BLACKSTAR_API_BASE: "https://api.blackstar.example",
      BLACKSTAR_WEBHOOK_SECRET: SECRET("w"),
      BLACKSTAR_OUTBOUND_SECRET: SECRET("o"),
    })
    expect(out).toContain("production env OK")
    expect(code).toBe(0)
  })

  it("does not require the global inbound secret once per-partner keys are required", () => {
    const { code } = gate({
      FBM_BLACKSTAR_INTEGRATION: "1",
      BLACKSTAR_REQUIRE_KEY_ID: "1",
      BLACKSTAR_API_BASE: "https://api.blackstar.example",
      BLACKSTAR_WEBHOOK_SECRET: SECRET("w"),
    })
    expect(code).toBe(0)
  })

  it("refuses a short or placeholder signing secret", () => {
    const short = gate({
      FBM_BLACKSTAR_INTEGRATION: "1",
      BLACKSTAR_API_BASE: "https://api.blackstar.example",
      BLACKSTAR_WEBHOOK_SECRET: "too-short",
      BLACKSTAR_OUTBOUND_SECRET: `CHANGE_ME_${SECRET("o")}`,
    })
    expect(short.code).toBe(1)
    expect(short.out).toContain("BLACKSTAR_WEBHOOK_SECRET must be at least 32 characters")
    expect(short.out).toContain("BLACKSTAR_OUTBOUND_SECRET starts with a banned placeholder prefix")
  })

  it("still requires the global inbound secret when BLACKSTAR_REQUIRE_KEY_ID is anything but 1", () => {
    // .env.production.example ships `# BLACKSTAR_REQUIRE_KEY_ID=0`, and the
    // events route tests `=== "1"`, so 0 keeps the global secret in use.
    const { code, out } = gate({
      FBM_BLACKSTAR_INTEGRATION: "1",
      BLACKSTAR_REQUIRE_KEY_ID: "0",
      BLACKSTAR_API_BASE: "https://api.blackstar.example",
      BLACKSTAR_WEBHOOK_SECRET: SECRET("w"),
    })
    expect(code).toBe(1)
    expect(out).toContain("BLACKSTAR_OUTBOUND_SECRET is required")
  })
})

describe("assert-env: the Blackstar outbound pair, whatever the flag says", () => {
  // Outbound (marketplace-webhooks blackstarEmitConfig) is live whenever both
  // values are set and never reads FBM_BLACKSTAR_INTEGRATION; with it, FBM
  // posts node.operator.approved carrying a newly minted per-node secret.
  it("refuses a placeholder signing secret with the flag off", () => {
    const { code, out } = gate({
      FBM_BLACKSTAR_INTEGRATION: "0",
      BLACKSTAR_API_BASE: "https://b.example",
      BLACKSTAR_WEBHOOK_SECRET: "changeme",
    })
    expect(code).toBe(1)
    expect(out).toContain("BLACKSTAR_WEBHOOK_SECRET matches a banned placeholder literal")
  })

  it("refuses half a pair with the flag unset, each way", () => {
    const secretOnly = gate({ BLACKSTAR_WEBHOOK_SECRET: SECRET("w") })
    expect(secretOnly.code).toBe(1)
    expect(secretOnly.out).toContain("BLACKSTAR_API_BASE is required")

    const baseOnly = gate({ BLACKSTAR_API_BASE: "https://b.example" })
    expect(baseOnly.code).toBe(1)
    expect(baseOnly.out).toContain("BLACKSTAR_WEBHOOK_SECRET is required")
  })

  it("refuses a short signing secret with the flag unset", () => {
    const { code, out } = gate({ BLACKSTAR_API_BASE: "https://b.example", BLACKSTAR_WEBHOOK_SECRET: "short" })
    expect(code).toBe(1)
    expect(out).toContain("BLACKSTAR_WEBHOOK_SECRET must be at least 32 characters")
  })

  it("passes a valid pair with the flag off, and the template's empty values", () => {
    const pair = gate({ BLACKSTAR_API_BASE: "https://b.example", BLACKSTAR_WEBHOOK_SECRET: SECRET("w") })
    expect(pair.out).toContain("production env OK")
    expect(pair.code).toBe(0)

    // backend/.env.template ships `BLACKSTAR_API_BASE=` and
    // `BLACKSTAR_WEBHOOK_SECRET=`: empty is unset, to the code and the gate.
    const empty = gate({ BLACKSTAR_API_BASE: "", BLACKSTAR_WEBHOOK_SECRET: "" })
    expect(empty.code).toBe(0)
  })

  it.each([
    ["http://blackstar.example", "cleartext: the per-node secret would travel unencrypted"],
    ["blackstar.example", "no scheme: fetch cannot parse it, every delivery goes DEAD"],
    ["https://", "no host"],
    [" ", "blank"],
    ["https://b c", "space in the host: starts with https:// and still cannot be parsed"],
    ["https://blackstar.example:notaport", "non-numeric port: cannot be parsed"],
    ["https://blackstar.example?x=1", "query: the appended delivery path would land in it"],
    ["https://blackstar.example#f", "fragment: the appended delivery path would never be sent"],
  ])("refuses BLACKSTAR_API_BASE=%j (%s)", (apiBase) => {
    const { code, out } = gate({
      FBM_BLACKSTAR_INTEGRATION: "1",
      BLACKSTAR_API_BASE: apiBase,
      BLACKSTAR_WEBHOOK_SECRET: SECRET("w"),
      BLACKSTAR_OUTBOUND_SECRET: SECRET("o"),
    })
    expect(code).toBe(1)
    expect(out).toContain("BLACKSTAR_API_BASE must be an https:// URL with a host")
  })

  it("passes an https destination with a port and a path", () => {
    const { code, out } = gate({
      BLACKSTAR_API_BASE: "https://api.blackstar.example:8443/bridge/",
      BLACKSTAR_WEBHOOK_SECRET: SECRET("w"),
    })
    expect(out).toContain("production env OK")
    expect(code).toBe(0)
  })

  it("names each key once when the flag and the presence rules both apply", () => {
    const { out } = gate({ FBM_BLACKSTAR_INTEGRATION: "1", BLACKSTAR_API_BASE: "http://b.example" })
    expect(out.match(/BLACKSTAR_API_BASE/g)).toHaveLength(1)
    expect(out.match(/BLACKSTAR_WEBHOOK_SECRET/g)).toHaveLength(1)
  })
})


describe("assert-env CLI: refuses, rather than skips, an env that is not production", () => {
  // assertProductionEnv() passes anything outside production (right for an
  // importer). The CLI used to inherit that, so the documented
  // `node --env-file=.env.production scripts/assert-env.mjs --app=backend`
  // printed "production env OK" whenever the shell already had a NODE_ENV:
  // Node lets an existing variable win over the file.
  const BAD_BLACKSTAR = { BLACKSTAR_API_BASE: "http://b.example", BLACKSTAR_WEBHOOK_SECRET: "changeme" }

  function cli(args: string[], env: Record<string, string>) {
    const run = spawnSync(process.execPath, [...args, SCRIPT, "--app=backend"], {
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
    })
    return { code: run.status, out: `${run.stdout}${run.stderr}` }
  }

  it.each([
    ["development", { NODE_ENV: "development" }],
    ["test", { NODE_ENV: "test" }],
    ["unset", {}],
  ])("exits 2 and says nothing was checked when NODE_ENV is %s", (_label, nodeEnv: Record<string, string>) => {
    const { NODE_ENV: _drop, ...rest } = BASE_PRODUCTION_ENV
    const { code, out } = cli([], { ...rest, ...BAD_BLACKSTAR, ...nodeEnv })
    expect(code).toBe(2)
    expect(out).toContain("not production: nothing was checked")
    expect(out).not.toContain("production env OK")
  })

  describe("the documented --env-file form", () => {
    let dir: string
    let envFile: string
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "assert-env-"))
      envFile = path.join(dir, "probe.env")
      fs.writeFileSync(
        envFile,
        Object.entries({ ...BASE_PRODUCTION_ENV, ...BAD_BLACKSTAR })
          .map(([k, v]) => `${k}=${v}`)
          .join("\n") + "\n"
      )
    })
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

    it("refuses instead of passing when the shell's NODE_ENV beats the file's", () => {
      const { code, out } = cli([`--env-file=${envFile}`], { NODE_ENV: "development" })
      expect(code).toBe(2)
      expect(out).not.toContain("production env OK")
    })

    it("runs its checks from a path with a space in it, or through a symlink", () => {
      // The entry-point test compared import.meta.url with `file://${argv[1]}`,
      // so from either path the script did nothing and exited 0.
      const spaced = path.join(dir, "with space")
      fs.mkdirSync(spaced)
      const copy = path.join(spaced, "assert-env.mjs")
      fs.copyFileSync(SCRIPT, copy)
      const link = path.join(dir, "link.mjs")
      fs.symlinkSync(copy, link)
      for (const entry of [copy, link]) {
        const run = spawnSync(process.execPath, [`--env-file=${envFile}`, entry, "--app=backend"], {
          env: { PATH: process.env.PATH ?? "" },
          encoding: "utf8",
        })
        expect({ entry: path.basename(entry), code: run.status }).toEqual({ entry: path.basename(entry), code: 1 })
        expect(`${run.stdout}${run.stderr}`).toContain("BLACKSTAR_WEBHOOK_SECRET matches a banned placeholder literal")
      }
    })

    it("checks the file when run with an empty environment (env -i)", () => {
      const { code, out } = cli([`--env-file=${envFile}`], {})
      expect(code).toBe(1)
      expect(out).toContain("BLACKSTAR_API_BASE must be an https:// URL with a host")
      expect(out).toContain("BLACKSTAR_WEBHOOK_SECRET matches a banned placeholder literal")
    })
  })
})
