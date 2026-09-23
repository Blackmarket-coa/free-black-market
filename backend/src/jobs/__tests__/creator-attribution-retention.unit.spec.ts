import {
  BATCH_SIZE,
  DEFAULT_CLICK_RETENTION_DAYS,
  DEFAULT_IDENTIFIER_RETENTION_DAYS,
  MAX_BATCHES_PER_RUN,
  readRetentionConfig,
  retentionCutoff,
  runCreatorAttributionRetention,
} from "../creator-attribution-retention"

const NOW = new Date("2026-09-22T04:30:00.000Z")
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

type Row = {
  id: string
  occurred_at: Date
  ip_hash: string | null
  user_agent_hash: string | null
  referrer: string | null
  country: string | null
  visitor_token: string
}

const click = (id: string, ageDays: number, over: Partial<Row> = {}): Row => ({
  id,
  occurred_at: daysAgo(ageDays),
  ip_hash: "ip",
  user_agent_hash: "ua",
  referrer: "https://example.test/",
  country: "US",
  visitor_token: `vis_${id}`,
  ...over,
})

/**
 * In-memory stand-in for the four service methods the job uses, plus
 * order-attribution mocks that must never be called.
 */
const makeService = (rows: Row[]) => {
  const store = new Map(rows.map((r) => [r.id, { ...r }]))
  const hasIdentifiers = (r: Row) =>
    r.ip_hash !== null || r.user_agent_hash !== null || r.referrer !== null
  const oldest = (pred: (r: Row) => boolean, limit: number) =>
    [...store.values()]
      .filter(pred)
      .sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime())
      .slice(0, limit)
      .map((r) => r.id)

  const service: any = {
    listClickEventIdsWithIdentifiersBefore: jest.fn(
      async (cutoff: Date, limit: number) =>
        oldest((r) => r.occurred_at < cutoff && hasIdentifiers(r), limit)
    ),
    anonymizeClickEventIdentifiers: jest.fn(async (ids: string[]) => {
      for (const id of ids) {
        const cur = store.get(id)
        if (cur) {
          store.set(id, { ...cur, ip_hash: null, user_agent_hash: null, referrer: null })
        }
      }
      return ids.length
    }),
    listClickEventIdsBefore: jest.fn(async (cutoff: Date, limit: number) =>
      oldest((r) => r.occurred_at < cutoff, limit)
    ),
    deleteClickEventsByIds: jest.fn(async (ids: string[]) => {
      for (const id of ids) store.delete(id)
      return ids.length
    }),
    updateOrderAttributions: jest.fn(),
    deleteOrderAttributions: jest.fn(),
    updateAffiliateLinks: jest.fn(),
    deleteAnalyticsEvents: jest.fn(),
  }
  return { service, store }
}

const defaults = {
  identifierRetentionDays: DEFAULT_IDENTIFIER_RETENTION_DAYS,
  clickRetentionDays: DEFAULT_CLICK_RETENTION_DAYS,
  now: NOW,
}

describe("jobs/creator-attribution-retention", () => {
  describe("readRetentionConfig", () => {
    it("uses the defaults when nothing is set", () => {
      expect(readRetentionConfig({})).toEqual({
        identifierRetentionDays: 30,
        clickRetentionDays: 365,
      })
    })

    it("accepts positive integers", () => {
      expect(
        readRetentionConfig({
          CREATOR_ATTRIBUTION_IDENTIFIER_RETENTION_DAYS: "14",
          CREATOR_ATTRIBUTION_CLICK_RETENTION_DAYS: " 90 ",
        })
      ).toEqual({ identifierRetentionDays: 14, clickRetentionDays: 90 })
    })

    it.each(["0", "-5", "abc", "1.5", "", "   ", "1e3", "30d"])(
      "falls back to the default for %p",
      (raw) => {
        expect(
          readRetentionConfig({
            CREATOR_ATTRIBUTION_IDENTIFIER_RETENTION_DAYS: raw,
            CREATOR_ATTRIBUTION_CLICK_RETENTION_DAYS: raw,
          })
        ).toEqual({ identifierRetentionDays: 30, clickRetentionDays: 365 })
      }
    )
  })

  describe("retentionCutoff", () => {
    it("subtracts whole days from now", () => {
      expect(retentionCutoff(NOW, 30)).toEqual(daysAgo(30))
      expect(retentionCutoff(NOW, 1).getTime()).toBe(NOW.getTime() - 86_400_000)
    })
  })

  describe("runCreatorAttributionRetention", () => {
    it("anonymises identifiers past the identifier window and deletes past the click window", async () => {
      const { service, store } = makeService([
        click("fresh", 1),
        click("edge", 29),
        click("stale", 31),
        click("ancient", 400),
      ])

      const result = await runCreatorAttributionRetention(service, defaults)

      expect(result).toEqual({
        anonymized: 2,
        deleted: 1,
        batches: 2,
        failures: 0,
        truncated: false,
      })
      // Younger than 30 days: untouched.
      expect(store.get("fresh")).toMatchObject({ ip_hash: "ip", user_agent_hash: "ua" })
      expect(store.get("edge")).toMatchObject({ referrer: "https://example.test/" })
      // Older than 30 days: identifiers gone, everything else kept.
      expect(store.get("stale")).toMatchObject({
        ip_hash: null,
        user_agent_hash: null,
        referrer: null,
        country: "US",
        visitor_token: "vis_stale",
      })
      // Older than 365 days: gone.
      expect(store.has("ancient")).toBe(false)
    })

    it("never touches order attributions, affiliate links or analytics events", async () => {
      const { service } = makeService([click("stale", 31), click("ancient", 400)])

      await runCreatorAttributionRetention(service, defaults)

      expect(service.updateOrderAttributions).not.toHaveBeenCalled()
      expect(service.deleteOrderAttributions).not.toHaveBeenCalled()
      expect(service.updateAffiliateLinks).not.toHaveBeenCalled()
      expect(service.deleteAnalyticsEvents).not.toHaveBeenCalled()
    })

    it("passes the configured cutoffs and the batch size to the service", async () => {
      const { service } = makeService([])

      await runCreatorAttributionRetention(service, {
        identifierRetentionDays: 7,
        clickRetentionDays: 90,
        now: NOW,
      })

      expect(service.listClickEventIdsWithIdentifiersBefore).toHaveBeenCalledWith(
        daysAgo(7),
        BATCH_SIZE
      )
      expect(service.listClickEventIdsBefore).toHaveBeenCalledWith(daysAgo(90), BATCH_SIZE)
      expect(service.anonymizeClickEventIdentifiers).not.toHaveBeenCalled()
      expect(service.deleteClickEventsByIds).not.toHaveBeenCalled()
    })

    it("works the table in batches of at most batchSize and terminates", async () => {
      const rows = Array.from({ length: 5 }, (_, i) => click(`c${i}`, 40 + i))
      const { service, store } = makeService(rows)

      const result = await runCreatorAttributionRetention(service, {
        ...defaults,
        batchSize: 2,
      })

      // 5 rows in batches of 2 -> 3 anonymise batches (2, 2, 1); the short
      // last batch ends the pass without another select.
      expect(result.anonymized).toBe(5)
      expect(result.batches).toBe(3)
      expect(result.truncated).toBe(false)
      for (const call of service.anonymizeClickEventIdentifiers.mock.calls) {
        expect(call[0].length).toBeLessThanOrEqual(2)
      }
      expect([...store.values()].every((r) => r.ip_hash === null)).toBe(true)
    })

    it("stops at the batch budget and reports that work remains", async () => {
      const rows = Array.from({ length: 10 }, (_, i) => click(`c${i}`, 40 + i))
      const { service, store } = makeService(rows)

      const result = await runCreatorAttributionRetention(service, {
        ...defaults,
        batchSize: 2,
        maxBatches: 3,
      })

      expect(result).toMatchObject({ anonymized: 6, batches: 3, truncated: true })
      expect([...store.values()].filter((r) => r.ip_hash !== null)).toHaveLength(4)
      // The budget is shared, so the delete pass did not run this time.
      expect(service.listClickEventIdsBefore).not.toHaveBeenCalled()
    })

    it("shares the batch budget across both passes", async () => {
      const { service } = makeService([
        click("stale", 40),
        click("older", 41),
        click("ancient", 400),
        click("fossil", 401),
      ])

      const result = await runCreatorAttributionRetention(service, {
        ...defaults,
        batchSize: 1,
        maxBatches: 5,
      })

      // Anonymise: 4 rows -> 4 full batches; delete: 1 batch before the budget hits.
      expect(result).toMatchObject({ anonymized: 4, deleted: 1, batches: 5, truncated: true })
    })

    it("terminates even when the service keeps returning the same ids", async () => {
      const service: any = {
        listClickEventIdsWithIdentifiersBefore: jest.fn(async () =>
          Array.from({ length: BATCH_SIZE }, (_, i) => `c${i}`)
        ),
        anonymizeClickEventIdentifiers: jest.fn(async (ids: string[]) => ids.length),
        listClickEventIdsBefore: jest.fn(async () => []),
        deleteClickEventsByIds: jest.fn(async (ids: string[]) => ids.length),
      }

      const result = await runCreatorAttributionRetention(service, defaults)

      expect(result.batches).toBe(MAX_BATCHES_PER_RUN)
      expect(result.truncated).toBe(true)
      expect(service.anonymizeClickEventIdentifiers).toHaveBeenCalledTimes(MAX_BATCHES_PER_RUN)
    })

    it("stops a pass on failure, counts it, and still runs the other pass", async () => {
      const { service, store } = makeService([click("stale", 40), click("ancient", 400)])
      service.anonymizeClickEventIdentifiers = jest.fn(async () => {
        throw new Error("update exploded")
      })

      const result = await runCreatorAttributionRetention(service, defaults)

      expect(result).toEqual({
        anonymized: 0,
        deleted: 1,
        batches: 2,
        failures: 1,
        truncated: false,
      })
      expect(store.has("ancient")).toBe(false)
      expect(store.get("stale")).toMatchObject({ ip_hash: "ip" })
    })

    it("is a no-op on an empty table", async () => {
      const { service } = makeService([])

      await expect(runCreatorAttributionRetention(service, defaults)).resolves.toEqual({
        anonymized: 0,
        deleted: 0,
        batches: 0,
        failures: 0,
        truncated: false,
      })
    })
  })
})
