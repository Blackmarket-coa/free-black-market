/**
 * Settlement emission tests.
 *
 * Two layers:
 *
 *   1. Pure compose — validates rail-vs-manifest, per-rail required
 *      fields, and the payload shape. The meaningful logic.
 *
 *   2. Service orchestration via the fake DB pattern from
 *      seed.unit.spec.ts / instance-lifecycle.unit.spec.ts —
 *      confirms emitSettlementRecord calls compose, persists the
 *      result, and surfaces validation errors before any write.
 *
 * Manifests under test:
 *   - Yard-scrap nursery: rails [ccr, usdc, usd, gift]
 *   - Tool library:       rails [hours, karma, ccr, gift]
 *   - Repair café:        rails [karma, gift]
 */

import {
  composeSettlement,
  assertRailAllowedForManifest,
  assertRailRequiredFields,
  SettlementValidationError,
  type SettlementIntent,
} from "../settlement"
import { YARD_SCRAP_NURSERY_MANIFEST as NURSERY } from "../manifests/yard-scrap-nursery"
import { TOOL_LIBRARY_MANIFEST as TOOLS } from "../manifests/tool-library"
import { REPAIR_CAFE_MANIFEST as REPAIR } from "../manifests/repair-cafe"

const base = (overrides: Partial<SettlementIntent> = {}): SettlementIntent => ({
  project_instance_id: "pi_1",
  manifest: NURSERY,
  rail: "ccr",
  amount_minor: 100,
  asset_code: "CCR",
  from_member_id: "mem_a",
  to_member_id: "mem_b",
  occurred_at: new Date("2026-05-13T00:00:00Z"),
  order_id: "order_1",
  ...overrides,
})

describe("assertRailAllowedForManifest", () => {
  it("accepts a rail the manifest declares", () => {
    expect(() => assertRailAllowedForManifest("ccr", NURSERY)).not.toThrow()
    expect(() => assertRailAllowedForManifest("usdc", NURSERY)).not.toThrow()
    expect(() => assertRailAllowedForManifest("karma", TOOLS)).not.toThrow()
    expect(() => assertRailAllowedForManifest("karma", REPAIR)).not.toThrow()
  })

  it("rejects a rail the manifest doesn't declare", () => {
    // Nursery doesn't use hours.
    expect(() => assertRailAllowedForManifest("hours", NURSERY)).toThrow(
      SettlementValidationError
    )
    // Repair café doesn't use ccr/usdc/usd/hours.
    expect(() => assertRailAllowedForManifest("ccr", REPAIR)).toThrow(
      SettlementValidationError
    )
    expect(() => assertRailAllowedForManifest("hours", REPAIR)).toThrow(
      SettlementValidationError
    )
  })

  it("error details name the offending rail and the allowed set", () => {
    try {
      assertRailAllowedForManifest("hours", NURSERY)
      throw new Error("should have thrown")
    } catch (err) {
      const e = err as SettlementValidationError
      expect(e.details.rail).toBe("hours")
      expect(e.details.manifest_slug).toBe("yard-scrap-nursery")
      expect(e.details.allowed_rails).toEqual(NURSERY.settlement_rails)
    }
  })
})

describe("assertRailRequiredFields — CCR (purchase context)", () => {
  it("passes with an order_id", () => {
    expect(() => assertRailRequiredFields(base({ order_id: "order_1" }))).not.toThrow()
  })

  it("passes with a cart_id", () => {
    expect(() =>
      assertRailRequiredFields(
        base({ order_id: undefined, cart_id: "cart_xyz" })
      )
    ).not.toThrow()
  })

  it("passes with a recognized purchase reference_type + id", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          order_id: undefined,
          reference_type: "ESCROW_FUND",
          reference_id: "esc_1",
        })
      )
    ).not.toThrow()
  })

  it("rejects when no purchase context is attached", () => {
    expect(() =>
      assertRailRequiredFields(base({ order_id: undefined }))
    ).toThrow(SettlementValidationError)
  })

  it("rejects when reference_type is recognized but reference_id is empty", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          order_id: undefined,
          reference_type: "ORDER",
          reference_id: "",
        })
      )
    ).toThrow(SettlementValidationError)
  })

  it("rejects when reference_type is not in the purchase-context vocabulary", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          order_id: undefined,
          reference_type: "TIMEBANK_LOAN",
          reference_id: "loan_1",
        })
      )
    ).toThrow(SettlementValidationError)
  })
})

describe("assertRailRequiredFields — HRS (time-bank)", () => {
  const hrsBase = (overrides: Partial<SettlementIntent> = {}): SettlementIntent =>
    base({
      manifest: TOOLS,
      rail: "hours",
      asset_code: "HRS",
      reference_type: "TIMEBANK_LOAN",
      reference_id: "loan_42",
      order_id: undefined,
      ...overrides,
    })

  it("passes with TIMEBANK_LOAN + reference_id and distinct members", () => {
    expect(() => assertRailRequiredFields(hrsBase())).not.toThrow()
  })

  it("passes with each time-bank reference_type", () => {
    for (const ref of [
      "TIMEBANK_LOAN",
      "TIMEBANK_RETURN",
      "TIMEBANK_REDISTRIBUTION",
      "TIMEBANK_OPEN_BALANCE",
    ]) {
      expect(() =>
        assertRailRequiredFields(hrsBase({ reference_type: ref }))
      ).not.toThrow()
    }
  })

  it("rejects without a time-bank reference_type", () => {
    expect(() =>
      assertRailRequiredFields(hrsBase({ reference_type: "ORDER" }))
    ).toThrow(/time-bank reference_type/)
  })

  it("rejects with an empty reference_id", () => {
    expect(() =>
      assertRailRequiredFields(hrsBase({ reference_id: "" }))
    ).toThrow(SettlementValidationError)
  })

  it("rejects self-transfer (from === to)", () => {
    expect(() =>
      assertRailRequiredFields(
        hrsBase({ from_member_id: "mem_x", to_member_id: "mem_x" })
      )
    ).toThrow(/same/)
  })
})

describe("assertRailRequiredFields — KARMA (accrual)", () => {
  const karmaBase = (
    overrides: Partial<SettlementIntent> = {}
  ): SettlementIntent =>
    base({
      manifest: REPAIR,
      rail: "karma",
      asset_code: "KARMA",
      karma_reason: "repair-completed",
      order_id: undefined,
      ...overrides,
    })

  it("passes with a karma_reason slug", () => {
    expect(() => assertRailRequiredFields(karmaBase())).not.toThrow()
  })

  it("rejects without a karma_reason", () => {
    expect(() =>
      assertRailRequiredFields(karmaBase({ karma_reason: undefined }))
    ).toThrow(/karma_reason/)
  })

  it("rejects with an empty karma_reason", () => {
    expect(() =>
      assertRailRequiredFields(karmaBase({ karma_reason: "" }))
    ).toThrow(SettlementValidationError)
  })
})

describe("assertRailRequiredFields — USD / USDC (cash)", () => {
  it("passes with a positive amount", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          rail: "usdc",
          asset_code: "USDC",
          amount_minor: 5_000,
          order_id: undefined,
        })
      )
    ).not.toThrow()
  })

  it("rejects with zero amount", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          rail: "usd",
          asset_code: "USD",
          amount_minor: 0,
          order_id: undefined,
        })
      )
    ).toThrow(/positive amount/)
  })

  it("rejects with a negative amount", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          rail: "usdc",
          asset_code: "USDC",
          amount_minor: -100,
          order_id: undefined,
        })
      )
    ).toThrow(/positive amount/)
  })
})

describe("assertRailRequiredFields — GIFT (audit-only)", () => {
  it("passes with no required fields beyond the common ones", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          manifest: NURSERY,
          rail: "gift",
          asset_code: "GIFT",
          amount_minor: 0,
          order_id: undefined,
        })
      )
    ).not.toThrow()
  })

  it("passes even with a non-zero amount (gift can record value for audit)", () => {
    expect(() =>
      assertRailRequiredFields(
        base({
          manifest: NURSERY,
          rail: "gift",
          asset_code: "GIFT",
          amount_minor: 250,
          order_id: undefined,
        })
      )
    ).not.toThrow()
  })
})

describe("composeSettlement — happy paths across all rails", () => {
  it("CCR nursery settlement carries the order id into metadata", () => {
    const payload = composeSettlement(
      base({
        manifest: NURSERY,
        rail: "ccr",
        asset_code: "CCR",
        amount_minor: 200,
        order_id: "order_42",
      })
    )
    expect(payload.manifest_slug).toBe("yard-scrap-nursery")
    expect(payload.rail).toBe("ccr")
    expect(payload.ledger_entry_id).toBeNull()
    expect(payload.metadata.order_id).toBe("order_42")
    expect(payload.amount_minor).toBe(200)
  })

  it("HRS tool-library settlement carries time-bank reference into metadata", () => {
    const payload = composeSettlement(
      base({
        manifest: TOOLS,
        rail: "hours",
        asset_code: "HRS",
        amount_minor: 250, // 2.5 hours in hundredths
        reference_type: "TIMEBANK_LOAN",
        reference_id: "loan_1",
        order_id: undefined,
      })
    )
    expect(payload.metadata.reference_type).toBe("TIMEBANK_LOAN")
    expect(payload.metadata.reference_id).toBe("loan_1")
  })

  it("KARMA repair-café settlement carries karma_reason + karma_source into metadata", () => {
    const payload = composeSettlement(
      base({
        manifest: REPAIR,
        rail: "karma",
        asset_code: "KARMA",
        amount_minor: 1,
        karma_reason: "repair-completed",
        karma_source: { module: "asset_graph", id: "pi_1" },
        from_member_id: "SYSTEM",
        to_member_id: "mem_fixer",
        order_id: undefined,
      })
    )
    expect(payload.metadata.karma_reason).toBe("repair-completed")
    expect(payload.metadata.karma_source_module).toBe("asset_graph")
    expect(payload.metadata.karma_source_id).toBe("pi_1")
    expect(payload.from_member_id).toBe("SYSTEM")
    expect(payload.to_member_id).toBe("mem_fixer")
  })

  it("GIFT nursery settlement persists with audit metadata only", () => {
    const payload = composeSettlement(
      base({
        manifest: NURSERY,
        rail: "gift",
        asset_code: "GIFT",
        amount_minor: 0,
        order_id: undefined,
        metadata: { note: "member-rate Commons donation" },
      })
    )
    expect(payload.rail).toBe("gift")
    expect(payload.amount_minor).toBe(0)
    expect(payload.metadata.note).toBe("member-rate Commons donation")
  })

  it("propagates project_instance_id and occurred_at verbatim", () => {
    const occurred = new Date("2026-07-04T12:00:00Z")
    const payload = composeSettlement(
      base({
        project_instance_id: "pi_special",
        occurred_at: occurred,
      })
    )
    expect(payload.project_instance_id).toBe("pi_special")
    expect(payload.occurred_at).toBe(occurred)
  })

  it("ledger_entry_id is always null (unsettled marker)", () => {
    const payload = composeSettlement(base())
    expect(payload.ledger_entry_id).toBeNull()
  })

  it("merges caller metadata with rail-specific metadata", () => {
    const payload = composeSettlement(
      base({
        manifest: TOOLS,
        rail: "hours",
        asset_code: "HRS",
        reference_type: "TIMEBANK_LOAN",
        reference_id: "loan_1",
        order_id: undefined,
        metadata: { custom: "value" },
      })
    )
    expect(payload.metadata).toEqual(
      expect.objectContaining({
        custom: "value",
        reference_type: "TIMEBANK_LOAN",
        reference_id: "loan_1",
      })
    )
  })
})

describe("composeSettlement — validation error paths", () => {
  it("throws SettlementValidationError when the rail isn't in the manifest's rails", () => {
    expect(() =>
      composeSettlement(
        base({
          manifest: REPAIR,
          rail: "ccr",
          asset_code: "CCR",
          order_id: "order_1",
        })
      )
    ).toThrow(SettlementValidationError)
  })

  it("throws when HRS lacks reference_type + reference_id even if rail is manifest-allowed", () => {
    expect(() =>
      composeSettlement(
        base({
          manifest: TOOLS,
          rail: "hours",
          asset_code: "HRS",
          reference_type: undefined,
          reference_id: undefined,
          order_id: undefined,
        })
      )
    ).toThrow(SettlementValidationError)
  })

  it("throws when KARMA lacks karma_reason", () => {
    expect(() =>
      composeSettlement(
        base({
          manifest: REPAIR,
          rail: "karma",
          asset_code: "KARMA",
          karma_reason: undefined,
          order_id: undefined,
        })
      )
    ).toThrow(SettlementValidationError)
  })

  it("manifest-rail check runs before per-rail field check", () => {
    // Provide HRS-style fields but with a manifest that doesn't allow HRS.
    // The error should name the manifest-rail problem, not the field problem.
    try {
      composeSettlement(
        base({
          manifest: NURSERY,
          rail: "hours",
          asset_code: "HRS",
          reference_type: "TIMEBANK_LOAN",
          reference_id: "loan_1",
          order_id: undefined,
        })
      )
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SettlementValidationError)
      expect((err as Error).message).toMatch(/not allowed by manifest/)
    }
  })
})

// ── service orchestration ───────────────────────────────────────────

import AssetGraphService from "../service"

const buildFakeService = () => {
  const records: any[] = []
  const inst = Object.create(AssetGraphService.prototype)
  inst.createSettlementRecords = jest.fn(async (payload: any) => {
    const row = { id: `sr_${records.length + 1}`, ...payload }
    records.push(row)
    return row
  })
  return { service: inst as AssetGraphService, records }
}

describe("emitSettlementRecord (service)", () => {
  it("persists a SettlementRecord on the happy path", async () => {
    const { service, records } = buildFakeService()
    const row = await service.emitSettlementRecord(
      base({
        manifest: TOOLS,
        rail: "hours",
        asset_code: "HRS",
        reference_type: "TIMEBANK_LOAN",
        reference_id: "loan_1",
        order_id: undefined,
        amount_minor: 250,
      })
    )
    expect(records).toHaveLength(1)
    expect(row.manifest_slug).toBe("tool-library")
    expect(row.rail).toBe("hours")
    expect(row.ledger_entry_id).toBeNull()
    expect(row.metadata.reference_type).toBe("TIMEBANK_LOAN")
  })

  it("throws SettlementValidationError before writing on a forbidden rail", async () => {
    const { service, records } = buildFakeService()
    await expect(
      service.emitSettlementRecord(
        base({
          manifest: REPAIR,
          rail: "ccr",
          asset_code: "CCR",
          order_id: "order_1",
        })
      )
    ).rejects.toBeInstanceOf(SettlementValidationError)
    expect(records).toHaveLength(0)
  })

  it("composeSettlementPayload returns the payload without persisting", () => {
    const { service, records } = buildFakeService()
    const payload = service.composeSettlementPayload(
      base({
        manifest: NURSERY,
        rail: "ccr",
        asset_code: "CCR",
        order_id: "order_99",
      })
    )
    expect(payload.manifest_slug).toBe("yard-scrap-nursery")
    expect(records).toHaveLength(0)
  })
})
