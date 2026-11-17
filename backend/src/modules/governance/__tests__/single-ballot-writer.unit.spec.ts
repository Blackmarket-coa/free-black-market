import fs from "fs"
import path from "path"
import ts from "typescript"
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
 *
 * What it guards, and what it does not. It finds code that names one of the
 * module's generated ballot mutators (`createGardenVotes`, `updateGardenVotes`,
 * ...): an identifier, or a string used as a property key. The files are
 * parsed, so a comment or a message that mentions a mutator is not a writer.
 * A ballot written by SQL is out of its reach. That is the migrations,
 * skipped by directory (two of them remove duplicate ballots and recount
 * tallies, once each), and customer erasure, which anonymises `garden_vote`
 * rows through `lib/customer-data-registry.ts` without naming a mutator.
 */
const SRC = path.join(__dirname, "../../..")

const BALLOT_MUTATOR = /^(?:create|update|upsert|delete|softDelete|restore)GardenVotes$/

/**
 * The ballot mutators a file's code names: identifiers, and string literals
 * used as a property key (`service["createGardenVotes"]`). Comments and other
 * strings are not code and are not counted.
 */
function ballotMutatorsNamed(file: string, text: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const named: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && BALLOT_MUTATOR.test(node.text)) named.push(node.text)
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      BALLOT_MUTATOR.test(node.argumentExpression.text)
    ) {
      named.push(node.argumentExpression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return named
}

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
    // The text match is only a cheap first pass over the tree; a file it
    // picks is parsed, and counts when its code names a mutator.
    const mentions = /(?:create|update|upsert|delete|softDelete|restore)GardenVotes/
    const writers = files
      .filter((file) => {
        const text = fs.readFileSync(file, "utf8")
        return mentions.test(text) && ballotMutatorsNamed(file, text).length > 0
      })
      .map((file) => path.relative(SRC, file))
    expect(writers).toEqual([path.join("modules", "governance", "service.ts")])
  })

  it("counts code that names a mutator, and not a comment or a message that does", () => {
    const named = (text: string) => ballotMutatorsNamed("probe.ts", text)
    expect(named("await governance.createGardenVotes(ballot)")).toEqual(["createGardenVotes"])
    expect(named("const { softDeleteGardenVotes: remove } = governance")).toEqual(["softDeleteGardenVotes"])
    expect(named('await governance["updateGardenVotes"](change)')).toEqual(["updateGardenVotes"])
    expect(named("const votes = await governance.listGardenVotes({})")).toEqual([])
    expect(
      named(
        [
          "// the old workflow inserted through createGardenVotes",
          "/** `deleteGardenVotes` was its compensation */",
          'log.info("ballots are written by castBallot, not createGardenVotes")',
          "const note = `see ${where}: updateGardenVotes is not called here`",
        ].join("\n")
      )
    ).toEqual([])
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
