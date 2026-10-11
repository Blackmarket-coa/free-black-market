import { Modules } from "@medusajs/framework/utils"

/**
 * Lets a spec wait for every in-app subscriber its events set off.
 *
 * Between tests the runner waits for stored workflow executions and then
 * truncates every table. Subscribers run on the local event bus fire and
 * forget, so nothing waits for them, and one still writing when the truncate
 * starts can make Postgres report a deadlock and fail a test that had already
 * passed. CI saw this on the subscription spec's lock-timeout scenario, whose
 * last checkout's order.placed subscribers were still running.
 *
 * Call it in a beforeEach. It routes the bus's dispatch through a tracker:
 * each listener is still called synchronously, as EventEmitter does, and its
 * promise is kept. Await the returned drain at the start of the spec's
 * afterEach, which runs before the runner's teardown. It returns once every
 * subscriber has settled, including any events they emitted in turn.
 */
export function trackSubscribers(container: () => any): () => Promise<void> {
  const emitter = (container().resolve(Modules.EVENT_BUS) as any).eventEmitter_
  const pending = new Set<Promise<unknown>>()
  jest.spyOn(emitter, "emit").mockImplementation((name: any, ...args: any[]) => {
    // rawListeners, as EventEmitter itself uses: a once() wrapper removes itself.
    const listeners = emitter.rawListeners(name) as Array<(...a: any[]) => unknown>
    for (const listener of listeners) {
      let run: Promise<unknown>
      try {
        run = Promise.resolve(listener(...args))
      } catch {
        run = Promise.resolve()
      }
      const settled = run.catch(() => undefined)
      pending.add(settled)
      void settled.finally(() => pending.delete(settled))
    }
    return listeners.length > 0
  })
  return async function drainSubscribers() {
    while (pending.size) await Promise.allSettled([...pending])
  }
}
