import { SkipStepAlreadyFinishedError } from "@medusajs/framework/orchestration"
import { ContainerRegistrationKeys, Modules, OrderWorkflowEvents, TransactionState } from "@medusajs/framework/utils"

/**
 * Workflow executions stalled mid-run, and a way to stall one on purpose.
 *
 * Medusa 2.14.2's workflow engine can leave an execution unfinished. Each
 * checkpoint it saves passes a guard that stops the execution when the step
 * looks "already finished by another execution". In a `parallelize` block the
 * steps share one flow object, so a step's own checkpoint can already show it
 * finished. The orchestrator then drops that step's continuation without an
 * error. When that step was the last of the block to finish, nothing runs the
 * next step, nothing compensates, and the execution stays `invoking` for good.
 * In `completeCartWorkflow` that block runs right after the order is
 * created, before the card is authorized. Seen here: every completion in
 * these specs hits the guard on that block's `register-usage` step, and the
 * stalls CI and local runs hit left exactly this state: the caller handed no
 * order id, the execution left unfinished. The runner's own wait between
 * tests then never ends (below).
 */

/** Not finished: every state the runner's wait between tests treats as still running. */
const UNFINISHED = [
  TransactionState.INVOKING,
  TransactionState.WAITING_TO_COMPENSATE,
  TransactionState.COMPENSATING,
]
const IN_UNFINISHED = `state IN (${UNFINISHED.map(() => "?").join(", ")})`

type Stalled = { workflow_id: string; transaction_id: string; state: string }

/**
 * Executions still unfinished after a short wait, marked failed so the next
 * test can start; returns them.
 *
 * Between tests `medusaIntegrationTestRunner` (test-utils 2.14.2) waits for
 * unfinished executions before it truncates the database. Its timeout throws
 * from a timer callback and its loop never stops, so one execution left
 * unfinished made every later hook spin until Jest's hook timeout: on CI, 17
 * tests of one spec timed out one after another, over 70 minutes. Call this,
 * after the subscriber drain, from an afterEach registered inside the spec's
 * describe blocks, which runs before the runner's own (see
 * drain-subscribers.ts), and fail the test when it returns anything.
 */
export async function clearStalledWorkflows(container: () => any, waitMs = 10_000): Promise<Stalled[]> {
  const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const unfinished = async (): Promise<Stalled[]> =>
    (
      await pg.raw(
        `SELECT workflow_id, transaction_id, state FROM workflow_execution
          WHERE deleted_at IS NULL AND ${IN_UNFINISHED} ORDER BY created_at`,
        UNFINISHED
      )
    ).rows
  const until = Date.now() + waitMs
  let rows = await unfinished()
  while (rows.length && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100))
    rows = await unfinished()
  }
  if (rows.length) {
    await pg.raw(`UPDATE workflow_execution SET state = ? WHERE deleted_at IS NULL AND ${IN_UNFINISHED}`, [
      TransactionState.FAILED,
      ...UNFINISHED,
    ])
  }
  return rows
}

/**
 * Make the next cart completion stall the way the engine's guard does: its
 * `order.placed` emit (the parallel block right after the order is created)
 * throws the guard's own error once. The other steps of that block run, so
 * the order, its cart link and the cart's `completed_at` are written and the
 * card is never authorized; the execution stays unfinished and its caller
 * gets no order id.
 */
export function stallNextCartCompletion(container: () => any): { stalled: () => boolean } {
  const bus = container().resolve(Modules.EVENT_BUS)
  const emit = bus.emit.bind(bus)
  let stalled = false
  jest.spyOn(bus, "emit").mockImplementation(async (data: any, options?: any) => {
    const names = (Array.isArray(data) ? data : [data]).map((e: any) => e?.name ?? e?.eventName)
    if (!stalled && names.includes(OrderWorkflowEvents.PLACED)) {
      stalled = true
      throw new SkipStepAlreadyFinishedError("Step emit-event-step already finished by another execution")
    }
    return emit(data, options)
  })
  return { stalled: () => stalled }
}
