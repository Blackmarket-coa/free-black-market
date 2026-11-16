import fs from "fs"
import path from "path"
import { WorkflowManager } from "@medusajs/framework/orchestration"
import * as governanceWorkflows from "../../../workflows/governance"

/**
 * `GovernanceModuleService.castBallot` is the only code that writes a ballot.
 *
 * It inserts the ballot and adds it to the tally in one transaction, under
 * the unique ballot index (service.ts). `workflows/governance/cast-vote.ts`
 * was a second writer that kept everything `castBallot` replaced: it read
 * the proposal, inserted through `createGardenVotes`, then wrote the tally
 * as absolute values from that read (the lost-increment race
 * `Migration20261116090000RecomputeActiveProposalTallies` repairs), took
 * `customer_id` and `membership_id` from its input with none of the route's
 * membership checks, and compensated by hard-deleting the ballot without
 * taking its weight back out of the tally.
 *
 * No route, job, subscriber or workflow called it, but it was not out of
 * reach: Medusa registers every workflow under `src/workflows` at boot, and
 * `POST /admin/workflows-executions/:workflow_id/run` runs a registered
 * workflow by id. It was deleted, not pointed at `castBallot`: with no
 * caller, a second entry point would have to copy the votes route's checks
 * and be kept in step with them.
 *
 * This walks the source so a second writer does not come back unnoticed.
 */
const SRC = path.join(__dirname, "../../..")

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Specs seed ballots on purpose; migrations are SQL over existing rows.
      return entry.name === "__tests__" || entry.name === "migrations" ? [] : sourceFiles(full)
    }
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe("ballots are written in one place", () => {
  const files = sourceFiles(SRC)

  it("walks the tree it thinks it does", () => {
    const relative = files.map((file) => path.relative(SRC, file))
    expect(relative).toContain(path.join("modules", "governance", "service.ts"))
    expect(relative).toContain(path.join("api", "store", "proposals", "[id]", "votes", "route.ts"))
    expect(relative).toContain(path.join("workflows", "governance", "finalize-proposal.ts"))
  })

  it("only the governance service creates, changes or removes a ballot", () => {
    const ballotWrite = /\b(?:create|update|upsert|delete|softDelete|restore)GardenVotes\b/
    const writers = files
      .filter((file) => ballotWrite.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file))
    expect(writers).toEqual([path.join("modules", "governance", "service.ts")])
  })

  it("the governance workflows register no vote-casting workflow", () => {
    // Importing a workflow's file registers it; Medusa's loader imports
    // every file under src/workflows at boot.
    expect(Object.keys(governanceWorkflows).sort()).toEqual(
      expect.arrayContaining(["createGardenProposalWorkflow", "finalizeProposalWorkflow"])
    )
    expect(Object.keys(governanceWorkflows).filter((name) => /vote/i.test(name))).toEqual([])
    const registered = [...WorkflowManager.getWorkflows().keys()]
    expect(registered).toEqual(expect.arrayContaining(["finalize-garden-proposal-workflow"]))
    expect(registered).not.toContain("cast-garden-vote-workflow")
    expect(registered.filter((id) => /vote/i.test(id))).toEqual([])
  })
})
