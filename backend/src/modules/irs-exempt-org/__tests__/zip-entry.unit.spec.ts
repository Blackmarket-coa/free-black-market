import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { listZipEntries, openZipEntry } from "../zip-entry"

const fixture = (name: string) => path.join(__dirname, "fixtures", name)

async function drain(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * The reader exists so Pub 78 and the revocation list can be opened with no
 * new dependency. It must handle exactly what those archives are (one
 * deflated entry) and refuse anything it does not understand rather than
 * emit garbage that the parsers would then skip line by line as "malformed".
 */
describe("zip-entry", () => {
  it("lists the single deflated entry of an IRS-shaped archive", async () => {
    const entries = await listZipEntries(fixture("pub78-sample.zip"))
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe("data-download-pub78.txt")
    expect(entries[0].method).toBe(8)
    expect(entries[0].uncompressedSize).toBeGreaterThan(entries[0].compressedSize)
  })

  it("inflates the entry to the exact bytes of the inner file", async () => {
    const { entry, stream } = await openZipEntry(fixture("pub78-sample.zip"))
    const text = await drain(stream)
    const expected = await fs.readFile(fixture("pub78-sample.txt"), "utf8")
    expect(entry.name).toBe("data-download-pub78.txt")
    expect(text).toBe(expected)
    expect(Buffer.byteLength(text)).toBe(entry.uncompressedSize)
  })

  it("inflates the revocation archive too", async () => {
    const { stream } = await openZipEntry(fixture("revocation-sample.zip"))
    const text = await drain(stream)
    expect(text).toBe(await fs.readFile(fixture("revocation-sample.txt"), "utf8"))
  })

  it("reads a stored (method 0) entry without inflating", async () => {
    const { entry, stream } = await openZipEntry(fixture("stored-entry.zip"))
    expect(entry.method).toBe(0)
    expect(await drain(stream)).toBe("first|line\r\nsecond|line\r\n")
  })

  it("selects an entry by name in a multi-entry archive", async () => {
    const names = (await listZipEntries(fixture("two-entries.zip"))).map((e) => e.name)
    expect(names).toEqual(["readme.txt", "data.txt"])
    const { stream } = await openZipEntry(fixture("two-entries.zip"), "data.txt")
    expect(await drain(stream)).toBe("a|b\r\nc|d\r\n")
    await expect(openZipEntry(fixture("two-entries.zip"), "missing.txt")).rejects.toThrow(/not found/)
  })

  it("refuses a file that is not a zip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zip-entry-spec-"))
    try {
      const notZip = path.join(dir, "plain.txt")
      await fs.writeFile(notZip, "000587764|Iglesia Bethesda Inc.|Lowell|MA|United States|PC\r\n".repeat(20))
      await expect(listZipEntries(notZip)).rejects.toThrow(/end-of-central-directory/)
      const tiny = path.join(dir, "tiny.bin")
      await fs.writeFile(tiny, "PK")
      await expect(listZipEntries(tiny)).rejects.toThrow(/too small/)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
