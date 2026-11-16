import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import backfillVendorPlanAssignments from "../backfill-vendor-plan-assignments"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { VendorPlanAssignedBy } from "../../modules/vendor-plan/models"

/**
 * Argument handling, which is what was broken. The script documented
 * `-- --default-plan=free --dry-run` and could not be run at all: `medusa
 * exec` drops everything after `--` (so the plan never arrived and the script
 * refused), and refuses `--default-plan=…` on its own as an unknown option.
 * Both checked against the real CLI on a migrated database.
 *
 * It is a dry run unless given `apply`: with enforcement live, the plan named
 * here is what every unassigned seller is limited to from that moment, so a
 * word that goes missing must leave it previewing.
 */

function makeContainer(sellerIds: string[], assigned: string[] = []) {
  const logger = {
    info: jest.fn((_m: string) => undefined),
    warn: jest.fn((_m: string) => undefined),
    error: jest.fn((_m: string) => undefined),
  }
  const graph = jest.fn(async () => ({ data: sellerIds.map((id) => ({ id })) }))
  const plans = {
    listVendorPlanAssignments: jest.fn(async ({ seller_id }: { seller_id: string }) =>
      assigned.includes(seller_id) ? [{ seller_id }] : []
    ),
    createVendorPlanAssignments: jest.fn(async (_input: Record<string, unknown>) => undefined),
  }
  return {
    container: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        if (key === VENDOR_PLAN_MODULE) return plans
        throw new Error(`unexpected container key "${key}"`)
      },
    },
    logger,
    graph,
    plans,
  }
}

const logged = (logger: { info: jest.Mock }) =>
  logger.info.mock.calls.map((c) => String(c[0])).join("\n")

const realArgv = process.argv
const realDryRunEnv = process.env.PLAN_BACKFILL_DRY_RUN

beforeEach(() => {
  delete process.env.PLAN_BACKFILL_DRY_RUN
})

afterEach(() => {
  process.argv = realArgv
  if (realDryRunEnv === undefined) delete process.env.PLAN_BACKFILL_DRY_RUN
  else process.env.PLAN_BACKFILL_DRY_RUN = realDryRunEnv
})

describe("backfill-vendor-plan-assignments arguments", () => {
  it("previews on `default-plan=free dry-run`: counts, writes nothing", async () => {
    const { container, plans, logger } = makeContainer(["sel_1", "sel_2"], ["sel_2"])

    await backfillVendorPlanAssignments({
      container,
      args: ["default-plan=free", "dry-run"],
    } as never)

    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
    expect(logged(logger)).toMatch(/default plan "free".*DRY RUN/)
    expect(logged(logger)).toMatch(/1 assigned, 1 already had an assignment \(dry run\)/)
  })

  it("previews on `default-plan=free` alone: a live run needs `apply`", async () => {
    const { container, plans, logger } = makeContainer(["sel_1", "sel_2"], ["sel_2"])

    await backfillVendorPlanAssignments({ container, args: ["default-plan=free"] } as never)

    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
    expect(logged(logger)).toMatch(/1 assigned, 1 already had an assignment \(dry run\)/)
    expect(logged(logger)).toContain("re-run with `default-plan=free apply`")
  })

  it("assigns the named plan on `default-plan=free apply`, skipping sellers that have one", async () => {
    const { container, plans } = makeContainer(["sel_1", "sel_2"], ["sel_2"])

    await backfillVendorPlanAssignments({
      container,
      args: ["default-plan=free", "apply"],
    } as never)

    expect(plans.createVendorPlanAssignments).toHaveBeenCalledTimes(1)
    expect(plans.createVendorPlanAssignments.mock.calls[0][0]).toMatchObject({
      seller_id: "sel_1",
      plan_code: "free",
      assigned_by: VendorPlanAssignedBy.MIGRATION,
    })
  })

  it("still refuses to run without a plan, and has no fallback", async () => {
    const { container, graph, plans } = makeContainer(["sel_1"])

    await expect(
      backfillVendorPlanAssignments({ container, args: ["dry-run"] } as never)
    ).rejects.toThrow(/default-plan=<code> is required/)
    expect(graph).not.toHaveBeenCalled()
    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
  })

  it("refuses the old `--default-plan=` spelling and names the one that works", async () => {
    const { container, graph } = makeContainer(["sel_1"])

    await expect(
      backfillVendorPlanAssignments({ container, args: ["--default-plan=free"] } as never)
    ).rejects.toThrow(/`default-plan=free`, not `--default-plan=free`/)
    expect(graph).not.toHaveBeenCalled()
  })

  it("refuses a `--` separator, whose words medusa exec dropped", async () => {
    process.argv = [
      realArgv[0],
      "/app/node_modules/@medusajs/cli/cli.js",
      "exec",
      "./src/scripts/backfill-vendor-plan-assignments.ts",
      "default-plan=free",
      "--",
      "dry-run",
    ]
    // `dry-run` was dropped, so `args` holds only the plan: without the
    // separator check this would have been a live run.
    const { container, plans } = makeContainer(["sel_1"])

    const run = backfillVendorPlanAssignments({ container, args: ["default-plan=free"] } as never)
    await expect(run).rejects.toThrow(/drops everything after "--"/)
    // The suggested command keeps the plan that did arrive.
    await expect(run).rejects.toThrow("`… default-plan=free dry-run`")
    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
  })

  it("refuses `apply dry-run` rather than reading it either way", async () => {
    const { container, graph, plans } = makeContainer(["sel_1"])

    await expect(
      backfillVendorPlanAssignments({
        container,
        args: ["default-plan=free", "apply", "dry-run"],
      } as never)
    ).rejects.toThrow(/"apply" and "dry-run" contradict each other/)
    expect(graph).not.toHaveBeenCalled()
    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
  })

  it("refuses a misspelt dry run instead of assigning plans live", async () => {
    const { container, plans } = makeContainer(["sel_1"])

    await expect(
      backfillVendorPlanAssignments({
        container,
        args: ["default-plan=free", "dryrun"],
      } as never)
    ).rejects.toThrow(/unknown argument "dryrun"/)
    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
  })

  it("refuses an unknown plan code", async () => {
    const { container, plans } = makeContainer(["sel_1"])

    await expect(
      backfillVendorPlanAssignments({ container, args: ["default-plan=frea"] } as never)
    ).rejects.toThrow(/unknown plan code "frea"/)
    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
  })

  it("keeps PLAN_BACKFILL_DRY_RUN=1 as a forced dry run, even with `apply`", async () => {
    process.env.PLAN_BACKFILL_DRY_RUN = "1"
    const { container, plans, logger } = makeContainer(["sel_1"])

    await backfillVendorPlanAssignments({
      container,
      args: ["default-plan=free", "apply"],
    } as never)

    expect(plans.createVendorPlanAssignments).not.toHaveBeenCalled()
    expect(logged(logger)).toContain("forced by PLAN_BACKFILL_DRY_RUN=1")
  })
})
