import { generateKeyPairSync } from "crypto"

import HawalaLedgerModuleService from "../service"
import {
  KARMA_SOURCE_MODULES,
  MAX_KARMA_DELTA_MAGNITUDE,
  buildKarmaAttestation,
  isKarmaUniqueViolation,
  validateKarmaEventInput,
  verifyKarmaAttestation,
} from "../karma"

/**
 * W4 (decision D7): the canonical karma write path.
 *
 * karma_event is the reputation event log — append-only by convention,
 * deduped by the partial unique (source_module, source_id) index,
 * transfer-prohibited by the Posture-A rail guard, and (new in W4)
 * source-attributed against a closed registry plus tamper-evident via a
 * per-event attestation. These tests pin the validation vocabulary, the
 * attestation's dark/signed duality, and recordKarmaEvent's idempotency
 * (pre-read and under the unique-index race), using the fake-service
 * idiom from transfer-idempotency.unit.spec.ts.
 */

const SIGNING_ENV = [
  "MARKETPLACE_SIGNING_PRIVATE_KEY_PEM",
  "MARKETPLACE_SIGNING_KEY_ID",
] as const

const savedEnv: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const key of SIGNING_ENV) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})
afterEach(() => {
  for (const key of SIGNING_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

const validInput = () => ({
  member_id: "mem_1",
  delta: 5,
  reason: "repair-completed",
  source_module: "asset_graph",
  source_id: "sr_1",
})

describe("validateKarmaEventInput", () => {
  it("accepts a well-formed system event", () => {
    expect(validateKarmaEventInput(validInput())).toEqual([])
  })

  it("accepts the historical reason vocabulary shapes", () => {
    for (const reason of [
      "repair-completed",
      "tool-loan-returned",
      "grower:order_placed",
      "wellness:review_five_star",
      "review:five_star",
    ]) {
      expect(validateKarmaEventInput({ ...validInput(), reason })).toEqual([])
    }
  })

  it("rejects malformed reasons", () => {
    for (const reason of ["", "UPPER", "-leading", "has space", "x".repeat(66)]) {
      expect(
        validateKarmaEventInput({ ...validInput(), reason }).length
      ).toBeGreaterThan(0)
    }
  })

  it("rejects zero, fractional, and capped deltas", () => {
    for (const delta of [0, 1.5, MAX_KARMA_DELTA_MAGNITUDE + 1, -MAX_KARMA_DELTA_MAGNITUDE - 1]) {
      expect(
        validateKarmaEventInput({ ...validInput(), delta }).length
      ).toBeGreaterThan(0)
    }
    expect(
      validateKarmaEventInput({ ...validInput(), delta: -MAX_KARMA_DELTA_MAGNITUDE })
    ).toEqual([])
  })

  it("requires registered source modules and their ids", () => {
    const unregistered = validateKarmaEventInput({
      ...validInput(),
      source_module: "not_a_module",
    })
    expect(unregistered.join(" ")).toMatch(/unregistered source_module/)

    const missingId = validateKarmaEventInput({
      ...validInput(),
      source_id: null,
    })
    expect(missingId.join(" ")).toMatch(/source_id is required/)
  })

  it("requires the explicit operator flag for unattributed grants", () => {
    const noFlag = validateKarmaEventInput({
      member_id: "mem_1",
      delta: 3,
      reason: "operator-grant",
      source_module: null,
    })
    expect(noFlag.join(" ")).toMatch(/operator: true/)

    expect(
      validateKarmaEventInput({
        member_id: "mem_1",
        delta: 3,
        reason: "operator-grant",
        source_module: null,
        operator: true,
      })
    ).toEqual([])
  })

  it("registry covers the planned W4 writers", () => {
    for (const source of [
      "asset_graph",
      "progression",
      "reviews",
      "vendor_verification",
    ]) {
      expect(KARMA_SOURCE_MODULES[source]).toBeTruthy()
    }
  })
})

describe("karma attestation", () => {
  const OCCURRED = "2026-08-30T00:00:00.000Z"

  it("always hashes; stays unsigned without signing keys (dark)", () => {
    const attestation = buildKarmaAttestation(validInput(), OCCURRED)
    expect(attestation.payload_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(attestation.signature).toBeUndefined()
    expect(attestation.key_id).toBeUndefined()

    const verdict = verifyKarmaAttestation({
      ...validInput(),
      occurred_at: OCCURRED,
      attestation,
    })
    expect(verdict.ok).toBe(true)
  })

  it("hash is deterministic and field-order independent", () => {
    const a = buildKarmaAttestation(validInput(), OCCURRED)
    const b = buildKarmaAttestation(
      {
        source_id: "sr_1",
        reason: "repair-completed",
        delta: 5,
        member_id: "mem_1",
        source_module: "asset_graph",
      },
      OCCURRED
    )
    expect(a.payload_sha256).toBe(b.payload_sha256)
  })

  it("signs under the marketplace key when configured, and the signature verifies", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
    process.env.MARKETPLACE_SIGNING_KEY_ID = "test-key-1"

    const attestation = buildKarmaAttestation(validInput(), OCCURRED)
    expect(attestation.key_id).toBe("test-key-1")
    expect(attestation.signature).toBeTruthy()

    const publicKeyPem = publicKey
      .export({ type: "spki", format: "pem" })
      .toString()
    const verdict = verifyKarmaAttestation(
      { ...validInput(), occurred_at: OCCURRED, attestation },
      { publicKeyPem }
    )
    expect(verdict).toEqual({ ok: true })
  })

  it("detects tampered fields and forged signatures", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    process.env.MARKETPLACE_SIGNING_PRIVATE_KEY_PEM = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
    process.env.MARKETPLACE_SIGNING_KEY_ID = "test-key-1"
    const attestation = buildKarmaAttestation(validInput(), OCCURRED)
    const publicKeyPem = publicKey
      .export({ type: "spki", format: "pem" })
      .toString()

    // Delta inflated after the fact → hash mismatch.
    const tampered = verifyKarmaAttestation(
      { ...validInput(), delta: 500, occurred_at: OCCURRED, attestation },
      { publicKeyPem }
    )
    expect(tampered.ok).toBe(false)
    expect(tampered.reason).toMatch(/hash mismatch/)

    // Signature swapped for garbage → signature mismatch.
    const forged = verifyKarmaAttestation(
      {
        ...validInput(),
        occurred_at: OCCURRED,
        attestation: {
          ...attestation,
          signature: Buffer.from("nope".repeat(16)).toString("base64"),
        },
      },
      { publicKeyPem }
    )
    expect(forged.ok).toBe(false)
    expect(forged.reason).toMatch(/signature/)
  })
})

describe("recordKarmaEvent (fake-service harness)", () => {
  function buildService(existing: any[] = []) {
    const svc: any = Object.create(HawalaLedgerModuleService.prototype)
    const rows = [...existing]
    svc.listKarmaEvents = jest.fn(async (filter: any) => {
      if (filter?.source_module !== undefined) {
        return rows.filter(
          (r) =>
            r.source_module === filter.source_module &&
            r.source_id === filter.source_id
        )
      }
      if (filter?.member_id !== undefined) {
        return rows.filter((r) => r.member_id === filter.member_id)
      }
      return rows
    })
    svc.createKarmaEvents = jest.fn(async (data: any) => {
      const row = { id: `ke_${rows.length + 1}`, ...data }
      rows.push(row)
      return row
    })
    return { svc, rows }
  }

  it("creates with a stamped attestation and reports created: true", async () => {
    const { svc } = buildService()
    const outcome = await svc.recordKarmaEvent(validInput())
    expect(outcome.created).toBe(true)
    const created = (svc.createKarmaEvents as jest.Mock).mock.calls[0][0]
    expect(created.attestation.payload_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(created.source_module).toBe("asset_graph")
  })

  it("is idempotent on the source pair via pre-read", async () => {
    const { svc } = buildService([
      {
        id: "ke_existing",
        member_id: "mem_1",
        source_module: "asset_graph",
        source_id: "sr_1",
      },
    ])
    const outcome = await svc.recordKarmaEvent(validInput())
    expect(outcome).toEqual({
      event: expect.objectContaining({ id: "ke_existing" }),
      created: false,
    })
    expect(svc.createKarmaEvents).not.toHaveBeenCalled()
  })

  it("resolves the unique-index race to the winner's row", async () => {
    const { svc, rows } = buildService()
    ;(svc.createKarmaEvents as jest.Mock).mockImplementationOnce(async () => {
      // Simulate: another writer won between the pre-read and our insert.
      rows.push({
        id: "ke_winner",
        member_id: "mem_1",
        source_module: "asset_graph",
        source_id: "sr_1",
      })
      const err = new Error(
        'duplicate key value violates unique constraint "UQ_karma_event_source"'
      ) as Error & { code?: string }
      err.code = "23505"
      throw err
    })
    const outcome = await svc.recordKarmaEvent(validInput())
    expect(outcome.created).toBe(false)
    expect(outcome.event.id).toBe("ke_winner")
  })

  it("throws on validation failure without writing", async () => {
    const { svc } = buildService()
    await expect(
      svc.recordKarmaEvent({ ...validInput(), source_module: "rogue_module" })
    ).rejects.toThrow(/unregistered source_module/)
    expect(svc.createKarmaEvents).not.toHaveBeenCalled()
  })

  it("sums a member's karma across the log", async () => {
    const { svc } = buildService([
      { id: "a", member_id: "mem_1", delta: 5 },
      { id: "b", member_id: "mem_1", delta: -2 },
      { id: "c", member_id: "mem_2", delta: 100 },
    ])
    await expect(svc.sumKarmaForMember("mem_1")).resolves.toBe(3)
  })
})

describe("isKarmaUniqueViolation", () => {
  it("matches pg 23505 and the named index; ignores other errors", () => {
    expect(isKarmaUniqueViolation({ code: "23505" })).toBe(true)
    expect(
      isKarmaUniqueViolation({ message: "violates UQ_karma_event_source" })
    ).toBe(true)
    expect(isKarmaUniqueViolation(new Error("connection refused"))).toBe(false)
    expect(isKarmaUniqueViolation(null)).toBe(false)
  })
})
