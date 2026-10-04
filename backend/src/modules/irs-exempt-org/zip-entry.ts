import { createReadStream, promises as fs } from "node:fs"
import { createInflateRaw } from "node:zlib"
import { PassThrough, type Readable } from "node:stream"

/**
 * A single-entry zip reader on `node:zlib`.
 *
 * Pub 78 and the Automatic Revocation list are published as zips (one
 * deflated text file each; compression method 8, no data descriptor, a `UT`
 * timestamp extra field — observed 2026-10-03). Node core has `inflateRaw` but
 * no container reader, the runtime image has no `unzip`, and a dependency
 * for ~90 lines of header parsing would widen the Trivy surface for nothing.
 * So: locate the central directory from the end-of-central-directory record,
 * walk its entries, find the one asked for, read that entry's local header,
 * and stream the compressed bytes through `createInflateRaw`. Nothing is
 * buffered beyond the directory itself.
 *
 * Deliberately narrow: no ZIP64, no encryption, methods 0 (stored) and 8
 * (deflate) only. Anything else throws rather than returning garbage.
 */

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const EOCD_MIN = 22
/** A zip comment can be at most 65535 bytes, so the EOCD is within this tail. */
const EOCD_SEARCH_MAX = EOCD_MIN + 0xffff

export type ZipEntryInfo = {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

async function readAt(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const { bytesRead } = await handle.read(buf, read, length - read, position + read)
    if (bytesRead === 0) break
    read += bytesRead
  }
  return read === length ? buf : buf.subarray(0, read)
}

/** The entries listed in the zip's central directory, in directory order. */
export async function listZipEntries(path: string): Promise<ZipEntryInfo[]> {
  const handle = await fs.open(path, "r")
  try {
    const { size } = await handle.stat()
    if (size < EOCD_MIN) throw new Error("zip: file too small to be a zip archive")

    const tailLen = Math.min(size, EOCD_SEARCH_MAX)
    const tail = await readAt(handle, size - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error("zip: end-of-central-directory record not found")

    const entryCount = tail.readUInt16LE(eocd + 10)
    const dirSize = tail.readUInt32LE(eocd + 12)
    const dirOffset = tail.readUInt32LE(eocd + 16)
    if (entryCount === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
      throw new Error("zip: ZIP64 archives are not supported")
    }

    const dir = await readAt(handle, dirOffset, dirSize)
    const entries: ZipEntryInfo[] = []
    let pos = 0
    for (let n = 0; n < entryCount; n++) {
      if (pos + 46 > dir.length || dir.readUInt32LE(pos) !== CENTRAL_SIG) {
        throw new Error("zip: malformed central directory")
      }
      const method = dir.readUInt16LE(pos + 10)
      const compressedSize = dir.readUInt32LE(pos + 20)
      const uncompressedSize = dir.readUInt32LE(pos + 24)
      const nameLen = dir.readUInt16LE(pos + 28)
      const extraLen = dir.readUInt16LE(pos + 30)
      const commentLen = dir.readUInt16LE(pos + 32)
      const localHeaderOffset = dir.readUInt32LE(pos + 42)
      const name = dir.subarray(pos + 46, pos + 46 + nameLen).toString("utf8")
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        throw new Error("zip: ZIP64 entries are not supported")
      }
      entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
      pos += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } finally {
    await handle.close()
  }
}

/**
 * A readable stream of one entry's uncompressed bytes. With no `entryName`
 * the first entry is used — the IRS zips hold exactly one file.
 */
export async function openZipEntry(
  path: string,
  entryName?: string
): Promise<{ entry: ZipEntryInfo; stream: Readable }> {
  const entries = await listZipEntries(path)
  if (entries.length === 0) throw new Error("zip: archive has no entries")
  const entry = entryName ? entries.find((e) => e.name === entryName) : entries[0]
  if (!entry) throw new Error(`zip: entry "${entryName}" not found`)
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`zip: unsupported compression method ${entry.method}`)
  }

  // The local header repeats the name/extra lengths, and the extra field can
  // differ from the central directory's, so the data offset must be read here.
  const handle = await fs.open(path, "r")
  let dataStart: number
  try {
    const local = await readAt(handle, entry.localHeaderOffset, 30)
    if (local.length < 30 || local.readUInt32LE(0) !== LOCAL_SIG) {
      throw new Error("zip: malformed local file header")
    }
    const nameLen = local.readUInt16LE(26)
    const extraLen = local.readUInt16LE(28)
    dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen
  } finally {
    await handle.close()
  }

  if (entry.compressedSize === 0) {
    const empty = new PassThrough()
    empty.end()
    return { entry, stream: empty }
  }

  const raw = createReadStream(path, {
    start: dataStart,
    end: dataStart + entry.compressedSize - 1,
  })
  if (entry.method === 0) return { entry, stream: raw }

  const inflate = createInflateRaw()
  raw.on("error", (err) => inflate.destroy(err))
  return { entry, stream: raw.pipe(inflate) }
}
