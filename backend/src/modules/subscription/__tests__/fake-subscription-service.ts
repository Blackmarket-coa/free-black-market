import SubscriptionModuleService from "../service"

/**
 * The REAL `SubscriptionModuleService` methods, bound onto an in-memory store.
 *
 * Only the three generated data-access methods are stubbed
 * (`retrieveSubscription`, `updateSubscriptions`, `listSubscriptions`); every
 * method this repo wrote — the transition guards, grace methods, renewal
 * charge record, failSubscription, getNextOrderDate — runs from the class
 * prototype. A spec that mutates one of those methods in `service.ts` fails.
 *
 * Not a spec (no `.spec.` in the name), so no jest mode collects it.
 */

export type FakeRow = Record<string, unknown> & { id: string; status: string }

type Filter = Record<string, unknown>

function matches(row: FakeRow, filter: Filter): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    const value = row[key]
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      const lte = (cond as { $lte?: unknown }).$lte
      if (lte !== undefined) {
        if (value === null || value === undefined) return false
        if (new Date(value as string).getTime() > new Date(lte as string).getTime()) {
          return false
        }
      }
      continue
    }
    if (Array.isArray(cond)) {
      if (!cond.includes(value)) return false
      continue
    }
    if (value !== cond) return false
  }
  return true
}

export type FakeSubscriptionService = SubscriptionModuleService & {
  store: Map<string, FakeRow>
  retrieveSubscription: jest.Mock
  updateSubscriptions: jest.Mock
  listSubscriptions: jest.Mock
}

export function makeSubscriptionService(rows: FakeRow[]): FakeSubscriptionService {
  const store = new Map<string, FakeRow>(rows.map((r) => [r.id, { ...r }]))

  const target: Record<string, unknown> = {
    store,
    retrieveSubscription: jest.fn(async (id: string) => {
      const row = store.get(id)
      if (!row) throw new Error(`Subscription with id: ${id} was not found`)
      return { ...row }
    }),
    updateSubscriptions: jest.fn(
      async ({ selector, data }: { selector: { id: string | string[] }; data: Record<string, unknown> }) => {
        const ids = Array.isArray(selector.id) ? selector.id : [selector.id]
        return ids.map((id) => {
          const next = { ...(store.get(id) as FakeRow), ...data } as FakeRow
          store.set(id, next)
          return { ...next }
        })
      }
    ),
    listSubscriptions: jest.fn(async (filter: Filter = {}) =>
      [...store.values()].filter((r) => matches(r, filter)).map((r) => ({ ...r }))
    ),
  }

  const proto = SubscriptionModuleService.prototype as unknown as Record<string, unknown>
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor" || name in target) continue
    const fn = proto[name]
    if (typeof fn === "function") {
      target[name] = (fn as (...a: unknown[]) => unknown).bind(target)
    }
  }

  return target as unknown as FakeSubscriptionService
}

/** A container whose resolve() throws on any key not registered — no silent fallbacks. */
export function makeContainer(registry: Record<string, unknown>) {
  return {
    resolve: jest.fn((key: string) => {
      if (!(key in registry)) {
        throw new Error(`test container: unexpected resolve("${key}")`)
      }
      return registry[key]
    }),
  }
}
