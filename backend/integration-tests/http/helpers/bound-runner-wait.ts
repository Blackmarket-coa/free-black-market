import path from "path"
import { ContainerRegistrationKeys, Modules, TransactionState } from "@medusajs/framework/utils"

/**
 * SD-53 open item (d), the runner half: `medusaIntegrationTestRunner`'s wait
 * between tests, bounded.
 *
 * test-utils 2.14.2 (`medusa-test-runner-utils/wait-workflow-executions.js`)
 * waits, in every `afterEach` and again in every `beforeEach` after the
 * first, for each workflow execution not `not_started`, `done`, `reverted` or
 * `failed`. Its 60-second timeout throws from a timer callback, which Jest
 * pins on whichever test is running, and its loop never exits. So one
 * execution Medusa's engine leaves unfinished (helpers/stalled-workflows.ts)
 * made every later hook of the file spin to Jest's hook timeout: 17 tests one
 * after another over 70 minutes on CI (#905). The specs that complete carts
 * end their own stalled executions before the runner's hook runs; a spec that
 * does not, or a workflow stalled where no spec looks, would still hang the
 * job.
 *
 * `boundedWaitWorkflowExecutions` waits for the same executions, by the same
 * filter, and returns as soon as there are none, as the runner's does. Past
 * the bound it marks them `failed`, so the next hook has nothing to wait on,
 * and rejects with an error naming SD-53 and each execution; the runner's
 * `afterEach` rethrows it, so that test fails with that message, and the file
 * goes on. The bound is the runner's own 60 seconds, under the 120-second
 * hook timeout integration:http sets (`FBM_TEST_WORKFLOW_WAIT_BOUND_MS`
 * shortens it, for the spec that proves it).
 *
 * `installRunnerWaitBound` puts it in place of the runner's own (jest.config.js,
 * integration:http `setupFiles`): the runner calls
 * `wait_workflow_executions_1.waitWorkflowExecutions` through the module's
 * exports object at each call, so replacing that property is enough. It
 * fails loudly if the module or the export has moved, rather than leave the
 * wait unbounded without a word.
 */

export const RUNNER_WAIT_BOUND_MS = 60_000
export const RUNNER_WAIT_BOUND_ENV = "FBM_TEST_WORKFLOW_WAIT_BOUND_MS"

/** The states the runner's wait treats as ended: exactly its own `$nin`. */
const ENDED = [TransactionState.NOT_STARTED, TransactionState.DONE, TransactionState.REVERTED, TransactionState.FAILED]

type Execution = { id: string; workflow_id: string; transaction_id: string; state: string }

export function boundedWaitWorkflowExecutions(boundMs?: number) {
  return async function waitWorkflowExecutions(container: any): Promise<void> {
    const wfe = container.resolve(Modules.WORKFLOW_ENGINE, { allowUnregistered: true })
    if (!wfe) return
    const limit = boundMs ?? (Number(process.env[RUNNER_WAIT_BOUND_ENV]) || RUNNER_WAIT_BOUND_MS)
    const until = Date.now() + limit
    for (;;) {
      const executions: Execution[] = await wfe.listWorkflowExecutions({ state: { $nin: ENDED } })
      if (!executions.length) return
      if (Date.now() >= until) {
        const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
        await pg.raw(
          `UPDATE workflow_execution SET state = ? WHERE id IN (${executions.map(() => "?").join(", ")})
            AND state NOT IN (${ENDED.map(() => "?").join(", ")})`,
          [TransactionState.FAILED, ...executions.map((e) => e.id), ...ENDED]
        )
        throw new Error(
          `SD-53: workflow executions still unfinished ${limit}ms after the test, marked failed so the next test can run ` +
            `(Medusa's runner would have waited for them forever): ` +
            executions.map((e) => `${e.workflow_id} (${e.state}) ${e.transaction_id}`).join(", ") +
            `. See docs/AUDIT_DEBT.md SD-53 and integration-tests/http/helpers/bound-runner-wait.ts.`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

/** The runner's own module, by its path inside the installed test-utils. */
export function runnerWaitModulePath(): string {
  return path.join(path.dirname(require.resolve("@medusajs/test-utils")), "medusa-test-runner-utils", "wait-workflow-executions.js")
}

export function installRunnerWaitBound(): void {
  const runnerWait = require(runnerWaitModulePath())
  if (typeof runnerWait?.waitWorkflowExecutions !== "function") {
    throw new Error(
      `SD-53 (d): @medusajs/test-utils no longer exports waitWorkflowExecutions from ${runnerWaitModulePath()}; ` +
        `the runner's wait between tests is unbounded again. Re-check integration-tests/http/helpers/bound-runner-wait.ts.`
    )
  }
  runnerWait.waitWorkflowExecutions = boundedWaitWorkflowExecutions()
}
