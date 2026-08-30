import PluginRegistryService from "../service"

/**
 * The install counter must be atomic under concurrency: a raw
 * `SET install_count = install_count + 1` when a pg connection is reachable,
 * with the historical read-modify-write as the DI-less fallback (route
 * harnesses and unit tests resolve no container).
 */

type RawCall = { sql: string; bindings: unknown[] }

function makeService(pgRow: Record<string, unknown> | undefined, calls: RawCall[]) {
  const service = Object.create(PluginRegistryService.prototype) as PluginRegistryService & {
    __container__: Record<string, unknown>
  }
  service.__container__ = {
    resolve: () => ({
      raw: async (sql: string, bindings: unknown[]) => {
        calls.push({ sql, bindings })
        return { rows: pgRow ? [pgRow] : [] }
      },
    }),
  }
  return service
}

describe("incrementInstallCount (atomic path)", () => {
  it("issues a single self-referential UPDATE ... RETURNING", async () => {
    const calls: RawCall[] = []
    const service = makeService({ slug: "sample", install_count: 6 }, calls)
    const updated = await service.incrementInstallCount("sample")
    expect(updated).toMatchObject({ slug: "sample", install_count: 6 })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toMatch(/SET "install_count" = "install_count" \+ 1/)
    expect(calls[0].sql).toMatch(/"deleted_at" IS NULL/)
    expect(calls[0].sql).toMatch(/RETURNING \*/)
    expect(calls[0].bindings).toEqual(["sample"])
  })

  it("throws on an unknown slug (no row returned)", async () => {
    const service = makeService(undefined, [])
    await expect(service.incrementInstallCount("ghost")).rejects.toThrow('Plugin "ghost" not found')
  })
})

describe("decrementInstallCount (atomic path)", () => {
  it("clamps at zero via GREATEST", async () => {
    const calls: RawCall[] = []
    const service = makeService({ slug: "sample", install_count: 0 }, calls)
    await service.decrementInstallCount("sample")
    expect(calls[0].sql).toMatch(/GREATEST\("install_count" - 1, 0\)/)
  })
})

describe("fallback path (no reachable pg connection)", () => {
  it("uses the legacy read-modify-write", async () => {
    const service = Object.create(PluginRegistryService.prototype) as PluginRegistryService
    const rows = [
      [{ id: "pl_1", slug: "sample", install_count: 2 }],
      [{ id: "pl_1", slug: "sample", install_count: 3 }],
    ]
    const listMock = jest.fn(async () => rows.shift() ?? [])
    const updateMock = jest.fn(async () => undefined)
    ;(service as unknown as Record<string, unknown>).listPluginListings = listMock
    ;(service as unknown as Record<string, unknown>).updatePluginListings = updateMock
    const updated = await service.incrementInstallCount("sample")
    expect(updateMock).toHaveBeenCalledWith({ id: "pl_1", install_count: 3 })
    expect(updated).toMatchObject({ install_count: 3 })
  })
})
