import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import ingestIrsExemptOrgs from "../ingest-irs-exempt-orgs"
import { runIrsExemptOrgIngest } from "../../jobs/irs-exempt-org-ingest"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"

jest.mock("../../jobs/irs-exempt-org-ingest", () => ({
  runIrsExemptOrgIngest: jest.fn(async () => ({ results: [] })),
}))

/**
 * Source names were already bare words, but `medusa exec` drops everything
 * after a `--` separator (checked against the real CLI), so
 * `… -- pub78` reached the script as [] and ingested all three sources: a few
 * hundred MB and ~1.9M rows instead of the one file asked for. An unknown
 * source also logged and exited 0.
 */

const ingest = runIrsExemptOrgIngest as jest.MockedFunction<typeof runIrsExemptOrgIngest>
const FLAG_ENV = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const realArgv = process.argv
const realFlag = process.env[FLAG_ENV]

function makeContainer() {
  const logger = {
    info: jest.fn((_m: string) => undefined),
    warn: jest.fn((_m: string) => undefined),
    error: jest.fn((_m: string) => undefined),
  }
  return {
    container: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`unexpected container key "${key}"`)
      },
    },
    logger,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env[FLAG_ENV] = "true"
})

afterEach(() => {
  process.argv = realArgv
  if (realFlag === undefined) delete process.env[FLAG_ENV]
  else process.env[FLAG_ENV] = realFlag
})

describe("ingest-irs-exempt-orgs arguments", () => {
  it("ingests only the sources named as bare words", async () => {
    const { container } = makeContainer()
    await ingestIrsExemptOrgs({ container, args: ["revocation", "pub78"] } as never)
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(ingest.mock.calls[0][1]).toEqual({ sources: ["pub78", "revocation"] })
  })

  it("ingests all three with no arguments", async () => {
    const { container } = makeContainer()
    await ingestIrsExemptOrgs({ container, args: [] } as never)
    expect(ingest.mock.calls[0][1]).toEqual({ sources: ["pub78", "revocation", "eo_bmf"] })
  })

  it("refuses `-- pub78` instead of ingesting all three", async () => {
    process.argv = [
      realArgv[0],
      "/app/node_modules/@medusajs/cli/cli.js",
      "exec",
      "./src/scripts/ingest-irs-exempt-orgs.ts",
      "--",
      "pub78",
    ]
    const { container } = makeContainer()
    await expect(ingestIrsExemptOrgs({ container, args: [] } as never)).rejects.toThrow(
      /drops everything after "--"/
    )
    expect(ingest).not.toHaveBeenCalled()
  })

  it("refuses an unknown source with a non-zero exit", async () => {
    const { container, logger } = makeContainer()
    await expect(
      ingestIrsExemptOrgs({ container, args: ["pub79"] } as never)
    ).rejects.toThrow(/unknown argument "pub79"; this script takes: pub78, revocation, eo_bmf/)
    expect(ingest).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it("does nothing with the flag off, whatever the arguments", async () => {
    process.env[FLAG_ENV] = "false"
    const { container, logger } = makeContainer()
    await ingestIrsExemptOrgs({ container, args: ["pub78"] } as never)
    expect(ingest).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })
})
