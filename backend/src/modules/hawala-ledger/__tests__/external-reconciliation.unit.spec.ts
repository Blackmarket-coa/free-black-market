import {
  amountToleranceCents,
  criterionMatches,
  deriveCandidateBounds,
  normalizeReference,
  reconcileRecords,
  validateCriteria,
  type EntryCandidate,
  type ExternalRecordInput,
} from "../external-reconciliation"
import HawalaLedgerModuleService from "../service"

/**
 * Unit tests for the external reconciliation engine:
 *
 *  1. Criteria validation rejects unknown kinds up front (never a
 *     silently-failing rule at match time).
 *  2. Rule semantics: AND within a rule, OR across rules, inclusive
 *     tolerance bounds, integer-cents math, currency pinning.
 *  3. The engine invariant: matched + unmatched === inputs, and one
 *     entry is claimed at most once per run.
 *  4. Service-level runExternalReconciliation: candidate SQL shape,
 *     persistence on a real run, and no persistence on a dry run.
 */

function ext(over: Partial<ExternalRecordInput> = {}): ExternalRecordInput {
  return {
    id: "ext-1",
    external_id: "po_123",
    amount_cents: 5000,
    currency_code: "USD",
    reference: "payout-req-1-net",
    occurred_at: new Date("2026-08-01T12:00:00Z"),
    ...over,
  }
}

function entry(over: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    id: "entry-1",
    amount_cents: 5000,
    currency_code: "USD",
    reference_id: "req-1",
    idempotency_key: "payout-req-1-net",
    correlation_id: "payout-req-1",
    created_at: new Date("2026-08-01T11:59:00Z"),
    ...over,
  }
}

describe("validateCriteria", () => {
  it("rejects empty and non-array criteria", () => {
    expect(() => validateCriteria([])).toThrow(/non-empty/)
    expect(() => validateCriteria({ kind: "amount" })).toThrow(/non-empty/)
  })

  it("rejects unknown kinds with a precise message", () => {
    expect(() => validateCriteria([{ kind: "amout" }])).toThrow(/criteria\[0\]: unknown kind "amout"/)
  })

  it("bounds tolerance_bps to 0..10000 and rejects negative cents", () => {
    expect(() => validateCriteria([{ kind: "amount", tolerance_bps: 10001 }])).toThrow(/0\.\.10000/)
    expect(() => validateCriteria([{ kind: "amount", tolerance_cents: -1 }])).toThrow(/non-negative/)
    expect(validateCriteria([{ kind: "amount", tolerance_cents: 0, tolerance_bps: 100 }])).toEqual([
      { kind: "amount", tolerance_cents: 0, tolerance_bps: 100 },
    ])
  })

  it("validates reference mode and date window", () => {
    expect(() => validateCriteria([{ kind: "reference", mode: "fuzzy" }])).toThrow(/exact.*normalized/)
    expect(() => validateCriteria([{ kind: "date", window_seconds: -5 }])).toThrow(/non-negative/)
  })
})

describe("criterion matching", () => {
  it("amount: inclusive tolerance, integer cents, magnitude comparison", () => {
    const c = { kind: "amount", tolerance_cents: 10 } as const
    expect(criterionMatches(c, ext({ amount_cents: 5010 }), entry())).toBe(true)
    expect(criterionMatches(c, ext({ amount_cents: 5011 }), entry())).toBe(false)
    // Signed external (Stripe payouts are negative on balance reports)
    // matches a positive internal magnitude.
    expect(criterionMatches(c, ext({ amount_cents: -5000 }), entry())).toBe(true)
  })

  it("amount: bps tolerance scales with the internal amount", () => {
    // 100 bps of 5000 = 50 cents
    expect(amountToleranceCents({ kind: "amount", tolerance_bps: 100 }, 5000)).toBe(50)
    const c = { kind: "amount", tolerance_bps: 100 } as const
    expect(criterionMatches(c, ext({ amount_cents: 5050 }), entry())).toBe(true)
    expect(criterionMatches(c, ext({ amount_cents: 5051 }), entry())).toBe(false)
  })

  it("reference: exact matches reference_id, idempotency_key, or correlation_id", () => {
    const c = { kind: "reference", mode: "exact" } as const
    expect(criterionMatches(c, ext({ reference: "req-1" }), entry())).toBe(true)
    expect(criterionMatches(c, ext({ reference: "payout-req-1" }), entry())).toBe(true)
    expect(criterionMatches(c, ext({ reference: "other" }), entry())).toBe(false)
    expect(criterionMatches(c, ext({ reference: null }), entry())).toBe(false)
  })

  it("reference: normalized strips case and punctuation", () => {
    expect(normalizeReference("PAYOUT req_1-NET")).toBe("payoutreq1net")
    const c = { kind: "reference", mode: "normalized" } as const
    expect(criterionMatches(c, ext({ reference: "PAYOUT-REQ-1-NET" }), entry())).toBe(true)
  })

  it("date: symmetric inclusive window; currency: case-insensitive pin", () => {
    const c = { kind: "date", window_seconds: 60 } as const
    expect(criterionMatches(c, ext(), entry())).toBe(true) // 60s apart exactly
    expect(
      criterionMatches(c, ext({ occurred_at: new Date("2026-08-01T12:00:01Z") }), entry())
    ).toBe(false) // 61s
    expect(criterionMatches({ kind: "currency" }, ext({ currency_code: "usd" }), entry())).toBe(true)
    expect(criterionMatches({ kind: "currency" }, ext({ currency_code: "CCR" }), entry())).toBe(false)
  })
})

describe("reconcileRecords", () => {
  const rule = {
    id: "rule-1",
    criteria: validateCriteria([
      { kind: "amount", tolerance_cents: 0 },
      { kind: "currency" },
    ]),
  }

  it("AND within a rule: one failing criterion fails the rule", () => {
    const outcome = reconcileRecords([ext({ currency_code: "CCR" })], [rule], () => [entry()])
    expect(outcome.matches).toHaveLength(0)
    expect(outcome.unmatched_external_ids).toEqual(["ext-1"])
  })

  it("OR across rules: a later rule can match, and attribution records which one", () => {
    const strict = { id: "strict", criteria: validateCriteria([{ kind: "reference", mode: "exact" }]) }
    const loose = { id: "loose", criteria: validateCriteria([{ kind: "amount", tolerance_cents: 100 }]) }
    const outcome = reconcileRecords(
      [ext({ reference: "nope", amount_cents: 5050 })],
      [strict, loose],
      () => [entry()]
    )
    expect(outcome.matches).toHaveLength(1)
    expect(outcome.matches[0].matched_by_rule_id).toBe("loose")
    expect(outcome.matches[0].amount_delta_cents).toBe(50)
  })

  it("claims each entry at most once across the run", () => {
    const shared = entry()
    const outcome = reconcileRecords(
      [ext({ id: "ext-1" }), ext({ id: "ext-2" })],
      [rule],
      () => [shared]
    )
    expect(outcome.matches).toHaveLength(1)
    expect(outcome.unmatched_external_ids).toEqual(["ext-2"])
  })

  it("matched + unmatched always equals the input count", () => {
    const externals = [ext({ id: "a" }), ext({ id: "b", amount_cents: 1 }), ext({ id: "c" })]
    const outcome = reconcileRecords(externals, [rule], (e) =>
      e.id === "c" ? [] : [entry({ id: `entry-${e.id}` })]
    )
    expect(outcome.matches.length + outcome.unmatched_external_ids.length).toBe(3)
  })

  it("prefers the deterministically first candidate (created_at, then id)", () => {
    const older = entry({ id: "entry-b", created_at: new Date("2026-08-01T10:00:00Z") })
    const newer = entry({ id: "entry-a", created_at: new Date("2026-08-01T11:00:00Z") })
    const outcome = reconcileRecords([ext()], [rule], () => [newer, older])
    expect(outcome.matches[0].ledger_entry_id).toBe("entry-b")
  })
})

describe("deriveCandidateBounds", () => {
  it("takes the widest union across rules and pins nothing a rule leaves open", () => {
    const rules = [
      { id: "r1", criteria: validateCriteria([{ kind: "amount", tolerance_cents: 10 }]) },
      {
        id: "r2",
        criteria: validateCriteria([
          { kind: "amount", tolerance_cents: 100 },
          { kind: "date", window_seconds: 60 },
        ]),
      },
    ]
    const bounds = deriveCandidateBounds(rules, ext())
    // Widest amount tolerance (100) + 1 rounding cent.
    expect(bounds.min_cents).toBe(5000 - 101)
    expect(bounds.max_cents).toBe(5000 + 101)
    // r1 has no date criterion, so the date dimension stays unbounded.
    expect(bounds.date_from).toBeNull()
    expect(bounds.date_to).toBeNull()
  })
})

describe("runExternalReconciliation (service)", () => {
  type RawCall = { sql: string; bindings: any[] }

  function buildService(pgRows: any[]) {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const calls: RawCall[] = []
    const state = {
      runs: [] as any[],
      matches: [] as any[],
      recordUpdates: [] as any[],
    }

    svc.__container__ = {
      resolve: jest.fn((key: string) => {
        if (key === "__pg_connection__" || key.includes("pg")) {
          return {
            raw: async (sql: string, bindings: any[]) => {
              calls.push({ sql, bindings })
              return { rows: pgRows }
            },
          }
        }
        throw new Error("AwilixResolutionError: not registered")
      }),
    }

    svc.createReconciliationRuns = jest.fn(async (d: any) => {
      const run = { id: "run-1", ...d }
      state.runs.push(run)
      return run
    })
    svc.updateReconciliationRuns = jest.fn(async (d: any) => {
      state.runs.push(d)
      return d
    })
    svc.listMatchingRules = jest.fn(async () => [
      {
        id: "rule-1",
        criteria: [
          { kind: "amount", tolerance_cents: 0 },
          { kind: "currency" },
        ],
      },
    ])
    svc.listExternalRecords = jest.fn(async () => [
      {
        id: "ext-1",
        external_id: "po_1",
        amount_cents: 5000,
        currency_code: "USD",
        reference: null,
        occurred_at: new Date("2026-08-01T12:00:00Z"),
      },
    ])
    svc.createReconciliationMatches = jest.fn(async (d: any) => {
      state.matches.push(d)
      return d
    })
    svc.updateExternalRecords = jest.fn(async (d: any) => {
      state.recordUpdates.push(d)
      return d
    })

    return { svc, calls, state }
  }

  const pgRow = {
    id: "entry-1",
    amount: "50.00",
    currency_code: "USD",
    reference_id: null,
    idempotency_key: null,
    correlation_id: null,
    created_at: "2026-08-01T11:59:00Z",
  }

  it("prefilters candidates with the settled-status SQL and persists matches", async () => {
    const { svc, calls, state } = buildService([pgRow])

    const outcome = await svc.runExternalReconciliation({ upload_id: "up-1" })

    expect(calls[0].sql).toContain(`"status" IN ('COMPLETED', 'SETTLED')`)
    expect(calls[0].sql).toContain(`ROUND("amount" * 100) BETWEEN ? AND ?`)
    expect(calls[0].sql).toContain(`"deleted_at" IS NULL`)
    expect(outcome.matched_count).toBe(1)
    expect(state.matches).toHaveLength(1)
    expect(state.matches[0].ledger_entry_id).toBe("entry-1")
    expect(state.recordUpdates).toEqual([{ id: "ext-1", status: "MATCHED" }])
  })

  it("dry runs compute counts but persist no matches and flip no statuses", async () => {
    const { svc, state } = buildService([pgRow])

    const outcome = await svc.runExternalReconciliation({ upload_id: "up-1", dry_run: true })

    expect(outcome.is_dry_run).toBe(true)
    expect(outcome.matched_count).toBe(1)
    expect(state.matches).toHaveLength(0)
    expect(state.recordUpdates).toHaveLength(0)
    // The run row itself still records the outcome.
    const final = state.runs[state.runs.length - 1]
    expect(final.status).toBe("COMPLETED")
    expect(final.matched_count).toBe(1)
  })

  it("marks the run FAILED and rethrows when no rules exist", async () => {
    const { svc, state } = buildService([pgRow])
    svc.listMatchingRules = jest.fn(async () => [])

    await expect(svc.runExternalReconciliation({ upload_id: "up-1" })).rejects.toThrow(
      /No matching rules/
    )
    const final = state.runs[state.runs.length - 1]
    expect(final.status).toBe("FAILED")
  })
})

describe("ingestExternalRecords (service)", () => {
  function buildService() {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const created: any[] = []
    const existing = new Set<string>()
    svc.listExternalRecords = jest.fn(async (f: any) => (existing.has(f.external_id) ? [{}] : []))
    svc.createExternalRecords = jest.fn(async (d: any) => {
      created.push(d)
      existing.add(d.external_id)
      return d
    })
    return { svc, created }
  }

  it("is idempotent per (upload_id, external_id) and reports per-row errors", async () => {
    const { svc, created } = buildService()
    const rows = [
      { external_id: "po_1", source: "STRIPE_PAYOUT", amount_cents: 100, occurred_at: "2026-08-01T00:00:00Z" },
      { external_id: "po_1", source: "STRIPE_PAYOUT", amount_cents: 100, occurred_at: "2026-08-01T00:00:00Z" },
      { external_id: "bad", source: "MANUAL", amount_cents: 1.5, occurred_at: "2026-08-01T00:00:00Z" },
      { external_id: "bad-date", source: "MANUAL", amount_cents: 1, occurred_at: "not-a-date" },
    ]
    const result = await svc.ingestExternalRecords(rows, "up-1")

    expect(result.ingested).toBe(1)
    expect(result.skipped_duplicates).toBe(1)
    expect(result.errors).toHaveLength(2)
    expect(created).toHaveLength(1)
    expect(result.upload_id).toBe("up-1")
  })
})
