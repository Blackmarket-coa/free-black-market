import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { IRS_DOWNLOAD_HOSTS, StreamDownloadError, streamDownloadToFile } from "../stream-download"

/**
 * The helper exists because `safeFetch` cannot carry these files, and it is
 * the first thing in the repo that streams a body to disk. What matters: the
 * host check happens before any request (and on every redirect), 304 means
 * no download, and what lands on disk is byte-for-byte the body with a hash
 * the caller can trust.
 */
describe("streamDownloadToFile", () => {
  let dir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-download-spec-"))
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const dest = (name: string) => path.join(dir, name)

  it("pins the allow-list to the two IRS hosts", () => {
    expect([...IRS_DOWNLOAD_HOSTS].sort()).toEqual(["apps.irs.gov", "www.irs.gov"])
  })

  it("refuses a host outside the allow-list before making any request", async () => {
    const fetchImpl = jest.fn()
    await expect(
      streamDownloadToFile("https://evil.example.com/pub78.zip", { destPath: dest("a"), fetchImpl })
    ).rejects.toMatchObject({ code: "host_not_allowed" })
    await expect(
      streamDownloadToFile("http://apps.irs.gov/pub/epostcard/data-download-pub78.zip", {
        destPath: dest("a"),
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: "host_not_allowed" })
    await expect(
      streamDownloadToFile("not a url", { destPath: dest("a"), fetchImpl })
    ).rejects.toBeInstanceOf(StreamDownloadError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("sends the conditional headers and treats 304 as no download", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(null, {
        status: 304,
        headers: { etag: '"1c8acc0-65b1d73f36898"', "last-modified": "Thu, 10 Sep 2026 09:18:37 GMT" },
      })
    )
    const since = new Date("2026-09-10T09:18:37Z")
    const result = await streamDownloadToFile("https://apps.irs.gov/pub/epostcard/data-download-pub78.zip", {
      destPath: dest("never-written"),
      ifNoneMatch: '"1c8acc0-65b1d73f36898"',
      ifModifiedSince: since,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      status: 304,
      lastModified: since,
      etag: '"1c8acc0-65b1d73f36898"',
      sha256: null,
      bytes: 0,
    })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://apps.irs.gov/pub/epostcard/data-download-pub78.zip")
    expect(init.redirect).toBe("manual")
    expect((init.headers as Record<string, string>)["if-none-match"]).toBe('"1c8acc0-65b1d73f36898"')
    expect((init.headers as Record<string, string>)["if-modified-since"]).toBe("Thu, 10 Sep 2026 09:18:37 GMT")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    await expect(fs.access(dest("never-written"))).rejects.toThrow()
  })

  it("omits conditional headers when the caller has nothing to compare against", async () => {
    const fetchImpl = jest.fn(async () => new Response("x", { status: 200 }))
    await streamDownloadToFile("https://www.irs.gov/pub/irs-soi/eo_xx.csv", {
      destPath: dest("x"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers).not.toHaveProperty("if-none-match")
    expect(headers).not.toHaveProperty("if-modified-since")
  })

  it("streams a 200 body to disk and reports its sha256, size and validators", async () => {
    const body = Buffer.from("EIN,NAME\n000019818,SOME ORG\n".repeat(1000))
    const fetchImpl = jest.fn(async () =>
      new Response(body, {
        status: 200,
        headers: { etag: '"abc"', "last-modified": "Mon, 07 Sep 2026 04:13:27 GMT" },
      })
    )
    const result = await streamDownloadToFile("https://www.irs.gov/pub/irs-soi/eo1.csv", {
      destPath: dest("eo1.csv"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.status).toBe(200)
    expect(result.bytes).toBe(body.length)
    expect(result.sha256).toBe(createHash("sha256").update(body).digest("hex"))
    expect(result.etag).toBe('"abc"')
    expect(result.lastModified).toEqual(new Date("2026-09-07T04:13:27Z"))
    expect(await fs.readFile(dest("eo1.csv"))).toEqual(body)
  })

  it("reports a null last-modified rather than an Invalid Date", async () => {
    const fetchImpl = jest.fn(async () => new Response("x", { status: 200, headers: { "last-modified": "garbage" } }))
    const result = await streamDownloadToFile("https://www.irs.gov/pub/irs-soi/eo2.csv", {
      destPath: dest("eo2.csv"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.lastModified).toBeNull()
  })

  it("follows a redirect only onto an allowed host", async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === "https://www.irs.gov/pub/irs-soi/eo3.csv") {
        return new Response(null, { status: 302, headers: { location: "https://apps.irs.gov/moved/eo3.csv" } })
      }
      return new Response("moved body", { status: 200 })
    })
    const result = await streamDownloadToFile("https://www.irs.gov/pub/irs-soi/eo3.csv", {
      destPath: dest("eo3.csv"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.bytes).toBe("moved body".length)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe("https://apps.irs.gov/moved/eo3.csv")
  })

  it("refuses a redirect off the allow-list without following it", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(null, { status: 301, headers: { location: "https://cdn.example.net/eo3.csv" } })
    )
    await expect(
      streamDownloadToFile("https://www.irs.gov/pub/irs-soi/eo3.csv", {
        destPath: dest("eo3b.csv"),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: "host_not_allowed" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("gives up after too many redirects", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://www.irs.gov/loop" } })
    )
    await expect(
      streamDownloadToFile("https://www.irs.gov/start", { destPath: dest("loop"), fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toMatchObject({ code: "too_many_redirects" })
  })

  it("rejects any other status instead of writing an error page to disk", async () => {
    const fetchImpl = jest.fn(async () => new Response("Service Unavailable", { status: 503 }))
    await expect(
      streamDownloadToFile("https://www.irs.gov/pub/irs-soi/eo4.csv", {
        destPath: dest("eo4.csv"),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ code: "http_status" })
    await expect(fs.access(dest("eo4.csv"))).rejects.toThrow()
  })

  it("times out via the abort signal it hands to fetch", async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")))
        })
    )
    await expect(
      streamDownloadToFile("https://www.irs.gov/pub/irs-soi/eo1.csv", {
        destPath: dest("slow"),
        timeoutMs: 20,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ name: "TimeoutError" })
  })
})
