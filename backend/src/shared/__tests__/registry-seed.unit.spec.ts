import { seedMissingRegistryRows, type RegistryModelService } from "../registry-seed"

type Row = { key: string; label: string }

const rows: Row[] = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
  { key: "c", label: "C" },
]

/** An in-memory registry with the two internal-service methods the seed uses. */
function registry(initial: Array<Row & { deleted_at?: Date | null }> = []) {
  const table = initial.map((row) => ({ ...row }))
  const service = {
    list: jest.fn(async (filters: Record<string, unknown>, config: { withDeleted?: boolean }) => {
      const keys = filters.key as string[]
      return table.filter(
        (row) => keys.includes(row.key) && (config.withDeleted || !row.deleted_at)
      )
    }),
    create: jest.fn(async (created: Row[]) => {
      for (const row of created) {
        if (table.some((existing) => existing.key === row.key)) {
          throw new Error(`duplicate key value violates unique constraint (${row.key})`)
        }
      }
      table.push(...created.map((row) => ({ ...row })))
      return created
    }),
  }
  return { table, service: service as RegistryModelService<Row> & typeof service }
}

const logger = () => ({ info: jest.fn(), warn: jest.fn() })

describe("seedMissingRegistryRows", () => {
  it("inserts every row into an empty registry, in one call", async () => {
    const { table, service } = registry()
    const log = logger()

    const outcome = await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: log })

    expect(outcome).toEqual({ status: "seeded", created: ["a", "b", "c"] })
    expect(service.create).toHaveBeenCalledTimes(1)
    expect(table.map((row) => row.key)).toEqual(["a", "b", "c"])
    expect(log.warn).not.toHaveBeenCalled()
  })

  it("inserts only the missing keys, and never rewrites a row that is there", async () => {
    // An operator's edit to "b" (its label) must survive the boot.
    const { table, service } = registry([{ key: "b", label: "Edited by an operator" }])

    const outcome = await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: logger() })

    expect(outcome).toEqual({ status: "seeded", created: ["a", "c"] })
    expect(service.create).toHaveBeenCalledWith([rows[0], rows[2]])
    expect(table.find((row) => row.key === "b")?.label).toBe("Edited by an operator")
    expect(table).toHaveLength(3)
  })

  it("counts a soft-deleted row as present: it is not inserted again", async () => {
    const { table, service } = registry([{ key: "a", label: "A", deleted_at: new Date() }])

    const outcome = await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: logger() })

    expect(service.list).toHaveBeenCalledWith({ key: ["a", "b", "c"] }, { withDeleted: true })
    expect(outcome).toEqual({ status: "seeded", created: ["b", "c"] })
    expect(table.filter((row) => row.key === "a")).toHaveLength(1)
  })

  it("writes nothing when every key is present, and running twice never duplicates", async () => {
    const { table, service } = registry()
    await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: logger() })
    service.create.mockClear()

    const again = await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: logger() })

    expect(again).toEqual({ status: "seeded", created: [] })
    expect(service.create).not.toHaveBeenCalled()
    expect(table).toHaveLength(3)
  })

  it("does not throw when the registry cannot be read (an unmigrated database): it logs and writes nothing", async () => {
    const { service } = registry()
    service.list.mockRejectedValueOnce(new Error('relation "playbook" does not exist'))
    const log = logger()

    const outcome = await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: log })

    expect(outcome).toEqual({ status: "failed", error: 'relation "playbook" does not exist' })
    expect(service.create).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("could not read the registry"))
  })

  it("reports another process's seed when its own insert loses the race", async () => {
    const { table, service } = registry()
    service.create.mockImplementationOnce(async () => {
      // The other instance commits first; this one's insert hits the unique key.
      table.push(...rows.map((row) => ({ ...row })))
      throw new Error("duplicate key value violates unique constraint")
    })
    const log = logger()

    const outcome = await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: log })

    expect(outcome).toEqual({ status: "seeded_elsewhere", created: [] })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it("logs a failed insert that left rows missing, and does not throw", async () => {
    const { service } = registry()
    service.create.mockRejectedValueOnce(new Error("connection reset"))
    const log = logger()

    const outcome = await seedMissingRegistryRows({ label: "[t]", service, key: "key", rows, logger: log })

    expect(outcome).toEqual({ status: "failed", error: "connection reset" })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("could not seed a, b, c: connection reset"))
  })
})
