import ReferralService from "../service"
import { ReferralSource, ReferralStatus } from "../attribution"

/**
 * `Object.create(Service.prototype)` + patched CRUD, per
 * `modules/vendor-billing/__tests__/service.unit.spec.ts`.
 */
type Row = Record<string, unknown> & { id: string; referred_seller_id: string }

const makeService = (opts: { rows?: Row[]; insertRaces?: boolean } = {}) => {
  const svc = Object.create(ReferralService.prototype) as Record<string, unknown>
  const rows: Row[] = [...(opts.rows ?? [])]
  let raced = false

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      Array.isArray(v) ? v.includes(row[k]) : row[k] === v
    )

  svc.listSellerReferrals = (async (where: Record<string, unknown> = {}) =>
    rows.filter((r) => matches(r, where))) as never

  svc.createSellerReferrals = (async (data: Record<string, unknown>) => {
    if (opts.insertRaces && !raced) {
      raced = true
      rows.push({ ...data, id: "sr_raced" } as Row)
      const err = new Error("duplicate key value violates unique constraint")
      ;(err as { code?: string }).code = "23505"
      throw err
    }
    const row = { ...data, id: `sr_${rows.length + 1}` } as Row
    rows.push(row)
    return row
  }) as never

  svc.updateSellerReferrals = (async (data: Record<string, unknown>) => {
    const row = rows.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }) as never

  return { svc: svc as unknown as ReferralService, rows }
}

const input = {
  referred_seller_id: "sel_referred",
  referrer_seller_id: "sel_referrer",
  source: ReferralSource.SELF,
}

describe("recordReferral", () => {
  it("records an active referral with a default earning window", async () => {
    const { svc } = makeService()
    const { referral, created } = await svc.recordReferral({
      ...input,
      attributed_at: new Date("2026-01-01T00:00:00.000Z"),
    })
    expect(created).toBe(true)
    expect(referral.status).toBe(ReferralStatus.ACTIVE)
    expect(referral.referrer_seller_id).toBe("sel_referrer")
    expect(referral.expires_at).toEqual(new Date("2027-01-01T00:00:00.000Z"))
  })

  it("refuses a self-referral outright", async () => {
    const { svc } = makeService()
    await expect(
      svc.recordReferral({ ...input, referrer_seller_id: "sel_referred" })
    ).rejects.toThrow(/own referrer/i)
  })

  it("is idempotent: a seller is referred once, later attributions are replays", async () => {
    const { svc, rows } = makeService()
    await svc.recordReferral(input)
    const second = await svc.recordReferral({
      ...input,
      referrer_seller_id: "sel_someone_else",
    })
    expect(second.created).toBe(false)
    // The first referrer stands; the second attribution did not fork the share.
    expect(second.referral.referrer_seller_id).toBe("sel_referrer")
    expect(rows).toHaveLength(1)
  })

  it("treats an insert race (23505) as a replay of the winner's row", async () => {
    const { svc, rows } = makeService({ insertRaces: true })
    const { referral, created } = await svc.recordReferral(input)
    expect(created).toBe(false)
    expect(referral.id).toBe("sr_raced")
    expect(rows).toHaveLength(1)
  })

  it("honours an explicit null expiry for a non-lapsing operator grant", async () => {
    const { svc } = makeService()
    const { referral } = await svc.recordReferral({
      ...input,
      source: ReferralSource.ADMIN,
      expires_at: null,
    })
    expect(referral.expires_at).toBeNull()
  })
})

describe("getActiveReferrer", () => {
  it("returns the referrer inside the window", async () => {
    const { svc } = makeService()
    await svc.recordReferral({
      ...input,
      attributed_at: new Date("2026-01-01T00:00:00.000Z"),
    })
    const active = await svc.getActiveReferrer(
      "sel_referred",
      new Date("2026-06-01T00:00:00.000Z")
    )
    expect(active?.referrer_seller_id).toBe("sel_referrer")
  })

  it("returns null once the window has closed, even before expiry is stored", async () => {
    const { svc } = makeService()
    await svc.recordReferral({
      ...input,
      attributed_at: new Date("2026-01-01T00:00:00.000Z"),
    })
    const active = await svc.getActiveReferrer(
      "sel_referred",
      new Date("2027-06-01T00:00:00.000Z")
    )
    expect(active).toBeNull()
  })

  it("returns null for an unreferred seller", async () => {
    const { svc } = makeService()
    expect(await svc.getActiveReferrer("sel_nobody")).toBeNull()
  })

  it("returns null after the referral is revoked", async () => {
    const { svc } = makeService()
    await svc.recordReferral({
      ...input,
      attributed_at: new Date("2026-01-01T00:00:00.000Z"),
    })
    await svc.revokeReferral("sel_referred")
    const active = await svc.getActiveReferrer(
      "sel_referred",
      new Date("2026-06-01T00:00:00.000Z")
    )
    expect(active).toBeNull()
  })
})

describe("expireLapsedReferrals", () => {
  it("flips only rows whose window has closed", async () => {
    const { svc, rows } = makeService()
    await svc.recordReferral({
      referred_seller_id: "sel_old",
      referrer_seller_id: "sel_r1",
      source: ReferralSource.SELF,
      attributed_at: new Date("2024-01-01T00:00:00.000Z"),
    })
    await svc.recordReferral({
      referred_seller_id: "sel_new",
      referrer_seller_id: "sel_r2",
      source: ReferralSource.SELF,
      attributed_at: new Date("2026-01-01T00:00:00.000Z"),
    })
    const flipped = await svc.expireLapsedReferrals(
      new Date("2026-06-01T00:00:00.000Z")
    )
    expect(flipped).toBe(1)
    expect(rows.find((r) => r.referred_seller_id === "sel_old")?.status).toBe(
      ReferralStatus.EXPIRED
    )
    expect(rows.find((r) => r.referred_seller_id === "sel_new")?.status).toBe(
      ReferralStatus.ACTIVE
    )
  })
})
