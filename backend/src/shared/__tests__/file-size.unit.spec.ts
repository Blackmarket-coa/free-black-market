import { Modules } from "@medusajs/framework/utils"
import { formatBytes, measureFileBytes } from "../file-size"

/**
 * The measurement exists so a storage cap counts a number the seller cannot
 * choose. Everything here is about the two ways that can go wrong: trusting
 * something we should not, or treating "could not measure" as "empty".
 */

const originalFetch = global.fetch

const makeContainer = (retrieveFile: unknown) => ({
  resolve: (key: string) => (key === Modules.FILE ? { retrieveFile } : undefined),
})

const mockHead = (
  init: { ok?: boolean; contentLength?: string | null } = {}
) => {
  const fn = jest.fn(async () => ({
    ok: init.ok ?? true,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === "content-length" ? (init.contentLength ?? null) : null,
    },
  }))
  global.fetch = fn as never
  return fn
}

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe("measureFileBytes", () => {
  const container = makeContainer(async () => ({
    url: "https://files.example.com/bucket/doc.pdf",
  }))

  it("reads the size from the object store", async () => {
    const fetchMock = mockHead({ contentLength: "204800" })

    const bytes = await measureFileBytes(container as never, "file_1")

    expect(bytes).toBe(204800)
    // HEAD, not GET: finding out a 2 GB file is too large must not require
    // downloading it first.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://files.example.com/bucket/doc.pdf",
      expect.objectContaining({ method: "HEAD" })
    )
  })

  it("returns null with no file id, without calling out", async () => {
    const fetchMock = mockHead()
    expect(await measureFileBytes(container as never, null)).toBeNull()
    expect(await measureFileBytes(container as never, "")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns null rather than zero when the store will not answer", async () => {
    // The load-bearing distinction. Zero would mean "this file is empty" and
    // would silently let an unmeasurable upload past a quota check that then
    // recorded it as costing nothing.
    mockHead({ ok: false })
    expect(await measureFileBytes(container as never, "file_1")).toBeNull()
  })

  it("returns null when there is no content-length", async () => {
    mockHead({ contentLength: null })
    expect(await measureFileBytes(container as never, "file_1")).toBeNull()
  })

  it("rejects a nonsense length instead of believing it", async () => {
    mockHead({ contentLength: "not-a-number" })
    expect(await measureFileBytes(container as never, "file_1")).toBeNull()

    mockHead({ contentLength: "-500" })
    expect(await measureFileBytes(container as never, "file_1")).toBeNull()
  })

  it("returns null when the file has no url", async () => {
    mockHead({ contentLength: "100" })
    const noUrl = makeContainer(async () => ({}))
    expect(await measureFileBytes(noUrl as never, "file_1")).toBeNull()
  })

  it("never throws when the file module or the network fails", async () => {
    // This runs on an upload path. A metering failure must not become an
    // availability problem on somebody's document.
    const throwing = makeContainer(async () => {
      throw new Error("file module unavailable")
    })
    await expect(
      measureFileBytes(throwing as never, "file_1")
    ).resolves.toBeNull()

    global.fetch = jest.fn(async () => {
      throw new Error("connection refused")
    }) as never
    await expect(
      measureFileBytes(container as never, "file_1")
    ).resolves.toBeNull()
  })
})

describe("formatBytes", () => {
  it("scales to the unit a person would use", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(100 * 1024 * 1024)).toBe("100.0 MB")
    expect(formatBytes(10 * 1024 * 1024 * 1024)).toBe("10.0 GB")
  })

  it("stops at the largest unit it knows rather than inventing one", () => {
    expect(formatBytes(5 * 1024 ** 5)).toBe("5120.0 TB")
  })

  it("clamps a negative to zero", () => {
    expect(formatBytes(-1)).toBe("0 B")
  })
})
