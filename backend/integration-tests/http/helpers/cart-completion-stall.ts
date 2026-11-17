import path from "path"
import { SkipStepAlreadyFinishedError } from "@medusajs/framework/orchestration"
import { ContainerRegistrationKeys, Modules, OrderWorkflowEvents, TransactionState } from "@medusajs/framework/utils"
import { completeCartWorkflowId } from "@medusajs/medusa/core-flows"
import { FINISHED_EXECUTION_STATES } from "../../../src/lib/cart-completion"

/**
 * SD-53 open item (d): a scenario that completes a cart, and is not about the
 * stall, is re-run on a fresh cart when Medusa's workflow engine stalls its
 * completion on its own, instead of going red on a defect its subject cannot
 * cause.
 *
 * Medusa 2.14.2's engine can leave `completeCartWorkflow` unfinished
 * (helpers/stalled-workflows.ts). FBM refuses that state on every path
 * (`lib/cart-completion.ts`, 409 `cart_completion_incomplete`), but a test
 * whose subject is a settlement, a replay or a renewal then fails on the
 * refusal: on CI, 4 of 10 runs, docs-only PRs among them, each failing test
 * leaving `complete-cart (waiting_to_compensate)` behind (or, for a
 * completion run on its own, reading back an order with no payment).
 *
 * The stall is told apart by the engine's own record of it, not by the test's
 * failure, which varies with where the stall lands (a refusal from
 * `require-completed-cart-order`, a 409 from a store route, a probe that never
 * ran, an order read back with no payment): a `complete-cart` execution this
 * attempt started is still in a state that is not an end state `settleMs`
 * after it — the same test, on the same row, as the production step's own
 * lookup (`FINISHED_EXECUTION_STATES`, `lib/cart-completion.ts`). A
 * completion that finishes is kept as `done` (Medusa stores it for three
 * days) and one rolled back ends `reverted` or `failed`, within that time; a
 * stall never ends. Nested in an FBM checkout, the stalled run's row reads
 * `waiting_to_compensate` once its caller compensates it; run on its own, it
 * stays `not_started`, because the in-memory engine writes no `invoking`
 * checkpoint for it (`saveToDb`), which is also why the runner, which counts
 * `not_started` as ended, never waits on that one. The workflow id is
 * Medusa's own constant, unless the spec names others (`workflowId`):
 * Mercur's main checkout runs `split-and-complete-cart` (FBM's
 * `SPLIT_AND_COMPLETE_CART_WORKFLOW_ID`) with the cart id as its transaction
 * id, and the engine stores that idempotent run's row as `not_started` when it
 * begins and deletes it when it ends, so a row still there `settleMs` later is
 * the same stall (helpers/stalled-workflows.ts; cart-completion-refuses.spec.ts
 * pins that state). Nothing else counts: another workflow left unfinished is
 * not this defect, and fails the test through the spec's own teardown check
 * as before.
 *
 * On a stall: one line `SD53_STALL_OBSERVED <spec> "<test>" attempt=<n> ...`
 * on stderr (grep CI logs for it to keep the frequency measurable), the
 * stalled executions marked `failed` so neither the next attempt nor the
 * runner's wait between tests waits on them, the spec put back as its
 * `beforeEach` left it (`reset`), and the scenario run again from its first
 * line, so on a new seller, product and cart. At most `retries` times (2):
 * a stall on every attempt fails the test with a message naming SD-53. An
 * attempt counts only if it ran with no stall, so an attempt whose
 * assertions happened to pass with a completion stalled is run again too.
 *
 * Not for a test whose subject is the stall or the refusal: those stall a
 * completion on purpose (`stallNextCartCompletion`) and assert what the
 * engine left; they use Jest's own `it`, as does all of
 * cart-completion-refuses.spec.ts.
 */

export const SD53_STALL_MARKER = "SD53_STALL_OBSERVED"
/** How many times a scenario is re-run after a stall before the test fails. */
export const SD53_STALL_RETRIES = 2
/** How long a `complete-cart` execution may stay unfinished after its attempt before it is read as stalled. */
export const SD53_STALL_SETTLE_MS = 10_000
/**
 * To prove the retry on the real specs: `SD53_INDUCE_STALLS=<n>` stalls the
 * first cart completion of each of the first n attempts of every test that
 * uses the helper (1: a stall the retry recovers from; 3: one it cannot).
 * Unset, nothing is induced.
 */
export const SD53_INDUCE_STALLS_ENV = "SD53_INDUCE_STALLS"

type Execution = { id: string; workflow_id: string; transaction_id: string; state: string }

export type CartCompletionStallRetryOptions = {
  container: () => any
  /**
   * Put the spec back as its `beforeEach` left it, before the next attempt:
   * settle what the stalled attempt set off (its subscribers), then what the
   * spec's `afterEach` and `beforeEach` do (restore every mock, reset the
   * flags, arm the Stripe stubs again).
   */
  reset: () => Promise<void> | void
  retries?: number
  settleMs?: number
  /**
   * The completion workflow(s) whose executions are watched: Medusa's
   * `complete-cart` (default), Mercur's `split-and-complete-cart` for a
   * spec that completes carts through `POST /store/carts/:id/complete`, or
   * both for one that does each.
   */
  workflowId?: string | readonly string[]
  /** Stall the first cart completion of each of the first n attempts (default: `SD53_INDUCE_STALLS`, else 0). */
  induceStalls?: number
  /** Where the marker line goes (default: stderr, one line, outside Jest's console buffering). */
  log?: (line: string) => void
}

export type StallRetryOutcome = {
  /** The attempt that counted: 1 when nothing stalled. */
  attempts: number
  /** What each stalled attempt left unfinished. */
  stalls: Execution[][]
}

const ENDED = [...FINISHED_EXECUTION_STATES]
const NOT_ENDED = `state NOT IN (${ENDED.map(() => "?").join(", ")})`
const describeExecutions = (rows: Execution[]) =>
  rows.map((r) => `${r.workflow_id}:${r.transaction_id}(${r.state})`).join(",")
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The watched completion workflows' executions not yet ended. */
async function unfinishedCompletions(pg: any, workflowIds: readonly string[]): Promise<Execution[]> {
  const { rows } = await pg.raw(
    `SELECT id, workflow_id, transaction_id, state FROM workflow_execution
      WHERE deleted_at IS NULL AND workflow_id IN (${workflowIds.map(() => "?").join(", ")}) AND ${NOT_ENDED} ORDER BY created_at`,
    [...workflowIds, ...ENDED]
  )
  return rows
}

/** Those not unfinished before the attempt that are still unfinished `settleMs` after it. */
async function stalledSince(pg: any, workflowIds: readonly string[], before: Set<string>, settleMs: number): Promise<Execution[]> {
  const fresh = async () => (await unfinishedCompletions(pg, workflowIds)).filter((row) => !before.has(row.id))
  const until = Date.now() + settleMs
  let rows = await fresh()
  while (rows.length && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    rows = await fresh()
  }
  return rows
}

/** End them, so nothing waits on them again: not the next attempt, the spec's teardown check or the runner. */
async function endStalled(pg: any, rows: Execution[]): Promise<void> {
  await pg.raw(
    `UPDATE workflow_execution SET state = ? WHERE id IN (${rows.map(() => "?").join(", ")}) AND ${NOT_ENDED}`,
    [TransactionState.FAILED, ...rows.map((r) => r.id), ...ENDED]
  )
}

/**
 * The next cart completion stalls as the engine's guard stalls it: its
 * `order.placed` emit, in the parallel block right after the order is
 * created, throws the guard's own error once (as `stallNextCartCompletion`
 * does). Spied one level below `emit`, on the bus's own
 * `groupOrEmitEvent`, so that a scenario that spies on `emit` itself (the
 * digital spec's capture count) neither replaces nor loops through it.
 * Removed by the next `jest.restoreAllMocks()`.
 */
function induceStall(container: () => any): void {
  const bus = container().resolve(Modules.EVENT_BUS)
  const original = bus.groupOrEmitEvent.bind(bus)
  let fired = false
  jest.spyOn(bus, "groupOrEmitEvent").mockImplementation(async (event: any) => {
    if (!fired && event?.name === OrderWorkflowEvents.PLACED) {
      fired = true
      throw new SkipStepAlreadyFinishedError("Step emit-event-step already finished by another execution")
    }
    return original(event)
  })
}

export function cartCompletionStallRetry(options: CartCompletionStallRetryOptions) {
  const retries = options.retries ?? SD53_STALL_RETRIES
  const settleMs = options.settleMs ?? SD53_STALL_SETTLE_MS
  const watched = options.workflowId ?? completeCartWorkflowId
  const workflowIds: readonly string[] = typeof watched === "string" ? [watched] : watched
  const induced = options.induceStalls ?? (Number(process.env[SD53_INDUCE_STALLS_ENV]) || 0)
  const log = options.log ?? ((line: string) => void process.stderr.write(`${line}\n`))

  /**
   * Run `scenario`, and again from its first line after each stall, up to
   * `retries` times. Rejects with the scenario's own error when it failed
   * with no stall, and with an SD-53 error when every attempt stalled.
   */
  async function run(scenario: () => Promise<unknown>): Promise<StallRetryOutcome> {
    const pg = options.container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const { currentTestName, testPath } = expect.getState()
    const spec = testPath ? path.basename(testPath) : "unknown-spec"
    const test = JSON.stringify(currentTestName ?? "unknown test")
    const attemptsAllowed = retries + 1
    const stalls: Execution[][] = []
    for (let attempt = 1; ; attempt++) {
      const before = new Set((await unfinishedCompletions(pg, workflowIds)).map((row) => row.id))
      if (attempt <= induced) induceStall(options.container)
      let failure: unknown = undefined
      let failed = false
      try {
        await scenario()
      } catch (error) {
        failed = true
        failure = error
      }
      const stalled = await stalledSince(pg, workflowIds, before, settleMs)
      if (!stalled.length) {
        if (failed) throw failure
        return { attempts: attempt, stalls }
      }
      stalls.push(stalled)
      await endStalled(pg, stalled)
      const exhausted = attempt >= attemptsAllowed
      log(
        `${SD53_STALL_MARKER} ${spec} ${test} attempt=${attempt} of=${attemptsAllowed} ` +
          `outcome=${exhausted ? "exhausted" : "retrying"} executions=${describeExecutions(stalled)} ` +
          `failure=${JSON.stringify(failed ? messageOf(failure).split("\n")[0].slice(0, 200) : "none")}`
      )
      if (exhausted) {
        throw new Error(
          `SD-53: Medusa's workflow engine left the cart completion unfinished on every attempt (${attempt}) of this scenario, ` +
            `each on a fresh cart: ${stalls.map(describeExecutions).join("; ")}. Not this test's subject; see ` +
            `docs/AUDIT_DEBT.md SD-53 and integration-tests/http/helpers/cart-completion-stall.ts. ` +
            `The last attempt's own result: ${failed ? messageOf(failure) : "its assertions passed with the completion unfinished"}`
        )
      }
      await options.reset()
    }
  }

  /** Jest's `it`, with the scenario run through `run`. */
  function stallRetryIt(name: string, scenario: () => Promise<unknown>, timeout?: number): void {
    it(
      name,
      async () => {
        await run(scenario)
      },
      timeout
    )
  }

  return { run, it: stallRetryIt }
}
