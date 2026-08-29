import {
  conditionMet,
  dollarsToCents,
  monitorTransition,
  normalizeOperator,
} from "../monitor-evaluator"
import HawalaLedgerModuleService from "../service"

/**
 * Unit tests for balance monitors:
 *
 *  1. Operator normalization ("=" → "==") and the full comparison matrix,
 *     including zero thresholds.
 *  2. Edge-triggering: alerts fire on the false→true transition only —
 *     a standing breach re-alerts nothing; clearing resets state.
 *  3. Service evaluation: breach rows persist with the observed value,
 *     the incident event carries enough context to act on without a
 *     re-fetch, and per-monitor failures never throw upward.
 */

describe("normalizeOperator", () => {
  it("normalizes '=' to '==' and rejects unknowns", () => {
    expect(normalizeOperator("=")).toBe("==")
    expect(normalizeOperator(" >= ")).toBe(">=")
    expect(() => normalizeOperator("=>")).toThrow(/Unknown monitor operator/)
  })
})

describe("conditionMet", () => {
  it("covers the comparison matrix in integer cents", () => {
    expect(conditionMet(-1, "<", 0)).toBe(true)
    expect(conditionMet(0, "<", 0)).toBe(false)
    expect(conditionMet(0, "<=", 0)).toBe(true)
    expect(conditionMet(0, "==", 0)).toBe(true) // zero threshold is valid
    expect(conditionMet(1, "!=", 0)).toBe(true)
    expect(conditionMet(500001, ">", 500000)).toBe(true)
    expect(conditionMet(500000, ">=", 500000)).toBe(true)
  })
})

describe("monitorTransition", () => {
  it("is edge-triggered", () => {
    expect(monitorTransition(false, true)).toBe("breach")
    expect(monitorTransition(true, true)).toBe("none")
    expect(monitorTransition(true, false)).toBe("clear")
    expect(monitorTransition(false, false)).toBe("none")
  })
})

describe("dollarsToCents", () => {
  it("rounds instead of truncating (the 0.29 * 100 = 28 float bug)", () => {
    expect(dollarsToCents(0.29)).toBe(29)
    expect(dollarsToCents("1234.56")).toBe(123456)
    expect(dollarsToCents(-5)).toBe(-500)
    expect(() => dollarsToCents(Number.NaN)).toThrow(/non-finite/)
  })
})

describe("evaluateMonitorsForAccounts (service)", () => {
  function buildService(opts: { balance: number; wasBreached?: boolean }) {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const state = {
      monitorUpdates: [] as any[],
      breaches: [] as any[],
      events: [] as Array<{ name: string; data: any }>,
    }
    const monitor = {
      id: "mon-1",
      account_id: "acc-settlement",
      field: "balance",
      operator: "<",
      threshold_cents: 0,
      severity: "critical",
      was_breached: opts.wasBreached ?? false,
      description: "settlement drain guard",
    }
    svc.listBalanceMonitors = jest.fn(async () => [monitor])
    svc.retrieveLedgerAccount = jest.fn(async () => ({
      id: "acc-settlement",
      balance: opts.balance,
      available_balance: opts.balance,
      pending_balance: 0,
    }))
    svc.updateBalanceMonitors = jest.fn(async (d: any) => {
      state.monitorUpdates.push(d)
      return d
    })
    svc.createMonitorBreaches = jest.fn(async (d: any) => {
      state.breaches.push(d)
      return d
    })
    const emit = jest.fn(async (name: string, data: any) => {
      state.events.push({ name, data })
    })
    return { svc, state, emit }
  }

  it("fires a breach with observed context on the false→true transition", async () => {
    const { svc, state, emit } = buildService({ balance: -12.34 })

    const summary = await svc.evaluateMonitorsForAccounts(["acc-settlement"], { emit })

    expect(summary).toEqual({ evaluated: 1, breaches: 1, cleared: 0 })
    expect(state.breaches).toHaveLength(1)
    expect(state.breaches[0].observed_cents).toBe(-1234)
    expect(state.breaches[0].incident_key).toBe("hawala-monitor-mon-1")

    const incident = state.events.find((e) => e.name === "observability.incident.triggered")
    expect(incident).toBeDefined()
    expect(incident!.data.severity).toBe("critical")
    expect(incident!.data.details.observed_cents).toBe(-1234)
    expect(incident!.data.details.account_id).toBe("acc-settlement")

    expect(state.monitorUpdates[0]).toMatchObject({ id: "mon-1", was_breached: true })
    expect(state.monitorUpdates[0].last_breached_at).toBeInstanceOf(Date)
  })

  it("does not re-alert a standing breach (edge-triggered)", async () => {
    const { svc, state, emit } = buildService({ balance: -12.34, wasBreached: true })

    const summary = await svc.evaluateMonitorsForAccounts(["acc-settlement"], { emit })

    expect(summary).toEqual({ evaluated: 1, breaches: 0, cleared: 0 })
    expect(state.breaches).toHaveLength(0)
    expect(state.events.filter((e) => e.name === "observability.incident.triggered")).toHaveLength(0)
  })

  it("records a clear transition and resets state without an incident", async () => {
    const { svc, state, emit } = buildService({ balance: 100, wasBreached: true })

    const summary = await svc.evaluateMonitorsForAccounts(["acc-settlement"], { emit })

    expect(summary).toEqual({ evaluated: 1, breaches: 0, cleared: 1 })
    expect(state.monitorUpdates[0]).toMatchObject({ id: "mon-1", was_breached: false })
    expect(state.events.map((e) => e.name)).toEqual(["observability.metric.recorded"])
  })

  it("swallows per-monitor failures and keeps evaluating", async () => {
    const { svc, emit } = buildService({ balance: -1 })
    svc.retrieveLedgerAccount = jest.fn(async () => {
      throw new Error("account gone")
    })

    await expect(
      svc.evaluateMonitorsForAccounts(["acc-settlement"], { emit })
    ).resolves.toEqual({ evaluated: 0, breaches: 0, cleared: 0 })
  })

  it("no-ops on an empty account list without touching the DB", async () => {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    svc.listBalanceMonitors = jest.fn()
    await expect(svc.evaluateMonitorsForAccounts([])).resolves.toEqual({
      evaluated: 0,
      breaches: 0,
      cleared: 0,
    })
    expect(svc.listBalanceMonitors).not.toHaveBeenCalled()
  })
})

describe("createBalanceMonitor (service)", () => {
  it("normalizes the operator, validates the field, and allows zero thresholds", async () => {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    svc.retrieveLedgerAccount = jest.fn(async () => ({ id: "acc-1" }))
    svc.createBalanceMonitors = jest.fn(async (d: any) => d)

    const monitor = await svc.createBalanceMonitor({
      account_id: "acc-1",
      operator: "=",
      threshold_cents: 0,
    })
    expect(monitor.operator).toBe("==")
    expect(monitor.threshold_cents).toBe(0)
    expect(monitor.field).toBe("balance")

    await expect(
      svc.createBalanceMonitor({ account_id: "acc-1", operator: ">", threshold_cents: 0.5 })
    ).rejects.toThrow(/integer/)
    await expect(
      svc.createBalanceMonitor({
        account_id: "acc-1",
        field: "inflight",
        operator: ">",
        threshold_cents: 1,
      })
    ).rejects.toThrow(/Unknown monitor field/)
  })
})
