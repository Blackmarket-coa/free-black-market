import { spawnSync } from "child_process"
import path from "path"

/**
 * The deploy env gate (`scripts/assert-env.mjs --app=backend`, `pnpm
 * assert-env`) for the Blackstar parcel bridge, run as the real CLI.
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
})
