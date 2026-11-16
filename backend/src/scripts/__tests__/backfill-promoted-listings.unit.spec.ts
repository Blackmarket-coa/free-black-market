import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import backfillPromotedListings from "../backfill-promoted-listings"
import {
  getPromotionState,
  grantPromotion,
} from "../../shared/promoted-listing-service"

jest.mock("../../shared/promoted-listing-service", () => ({
  getPromotionState: jest.fn(),
  grantPromotion: jest.fn(),
}))

/**
 * Argument handling, which is what was broken: the script documented
 * `--dry-run`, and `medusa exec` refuses that as an unknown option before the
 * script loads (checked against the real CLI), so it could not be previewed.
 * `… -- --dry-run` was worse: the words after `--` are dropped, and the script
 * would have run live.
 */

const getState = getPromotionState as jest.MockedFunction<typeof getPromotionState>
const grant = grantPromotion as jest.MockedFunction<typeof grantPromotion>

function makeContainer(featuredSellerIds: string[]) {
  const logger = {
    info: jest.fn((_m: string) => undefined),
    warn: jest.fn((_m: string) => undefined),
    error: jest.fn((_m: string) => undefined),
  }
  const graph = jest.fn(async () => ({
    data: featuredSellerIds.map((seller_id) => ({ seller_id })),
  }))
  return {
    container: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unexpected container key "${key}"`)
      },
    },
    logger,
    graph,
  }
}

const logged = (logger: { info: jest.Mock }) =>
  logger.info.mock.calls.map((c) => String(c[0])).join("\n")

const realArgv = process.argv

beforeEach(() => {
  jest.clearAllMocks()
  getState.mockResolvedValue({ active: false, expires_at: null, granted_at: null })
  grant.mockResolvedValue({ active: true, expires_at: null, granted_at: new Date() })
})

afterEach(() => {
  process.argv = realArgv
})

describe("backfill-promoted-listings arguments", () => {
  it("previews on the bare word `dry-run`: counts, grants nothing", async () => {
    const { container, logger } = makeContainer(["sel_1", "sel_2"])

    await backfillPromotedListings({ container, args: ["dry-run"] } as never)

    expect(grant).not.toHaveBeenCalled()
    expect(logged(logger)).toMatch(/2 featured seller\(s\) found \(dry run\)/)
    expect(logged(logger)).toMatch(/adopted 2, already held 0, failed 0/)
  })

  it("grants with no arguments, as documented", async () => {
    const { container } = makeContainer(["sel_1"])

    await backfillPromotedListings({ container, args: [] } as never)

    expect(grant).toHaveBeenCalledTimes(1)
    expect(grant.mock.calls[0][1]).toMatchObject({ sellerId: "sel_1", tierCode: null })
  })

  it("refuses `--dry-run` before reading anything", async () => {
    const { container, graph, logger } = makeContainer(["sel_1"])

    await expect(
      backfillPromotedListings({ container, args: ["--dry-run"] } as never)
    ).rejects.toThrow(/refused.*`dry-run`, not `--dry-run`/)
    expect(graph).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it("refuses `-- dry-run`, which would otherwise have been a live run", async () => {
    // `npx medusa exec <file> -- dry-run`: `args` is [], the word survives only
    // in process.argv.
    process.argv = [
      realArgv[0],
      "/app/node_modules/@medusajs/cli/cli.js",
      "exec",
      "./src/scripts/backfill-promoted-listings.ts",
      "--",
      "dry-run",
    ]
    const { container, graph } = makeContainer(["sel_1"])

    await expect(
      backfillPromotedListings({ container, args: [] } as never)
    ).rejects.toThrow(/drops everything after "--"/)
    expect(graph).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
  })

  it("refuses a misspelt dry run rather than running live", async () => {
    const { container } = makeContainer(["sel_1"])

    await expect(
      backfillPromotedListings({ container, args: ["dryrun"] } as never)
    ).rejects.toThrow(/unknown argument "dryrun"; this script takes: dry-run/)
    expect(grant).not.toHaveBeenCalled()
  })
})
