import {
  assertPublicHttpUrl,
  BlockedUrlError,
  safeFetch,
} from "../safe-fetch"

describe("assertPublicHttpUrl", () => {
  it("allows a public IP literal over https", async () => {
    const url = await assertPublicHttpUrl("https://8.8.8.8/path")
    expect(url.hostname).toBe("8.8.8.8")
  })

  it("allows http only when allowHttp is set", async () => {
    await expect(assertPublicHttpUrl("http://8.8.8.8")).rejects.toBeInstanceOf(
      BlockedUrlError
    )
    const url = await assertPublicHttpUrl("http://8.8.8.8", { allowHttp: true })
    expect(url.protocol).toBe("http:")
  })

  it("rejects non-http(s) schemes", async () => {
    await expect(
      assertPublicHttpUrl("ftp://8.8.8.8", { allowHttp: true })
    ).rejects.toBeInstanceOf(BlockedUrlError)
    await expect(
      assertPublicHttpUrl("file:///etc/passwd")
    ).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it("rejects embedded credentials", async () => {
    await expect(
      assertPublicHttpUrl("https://user:pass@8.8.8.8")
    ).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it.each([
    ["loopback", "https://127.0.0.1"],
    ["cloud metadata", "https://169.254.169.254"],
    ["private 10/8", "https://10.0.0.1"],
    ["private 172.16/12", "https://172.16.5.4"],
    ["private 192.168/16", "https://192.168.1.1"],
    ["CGNAT 100.64/10", "https://100.64.0.1"],
    ["unspecified", "https://0.0.0.0"],
    ["ipv6 loopback", "https://[::1]"],
    ["ipv6 link-local", "https://[fe80::1]"],
    ["ipv6 ULA", "https://[fd00::1]"],
    ["ipv4-mapped ipv6", "https://[::ffff:127.0.0.1]"],
  ])("rejects %s", async (_label, target) => {
    await expect(assertPublicHttpUrl(target)).rejects.toBeInstanceOf(
      BlockedUrlError
    )
  })
})

describe("safeFetch", () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  it("re-validates redirect targets and blocks internal hops", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      status: 302,
      ok: false,
      headers: new Headers({ location: "http://127.0.0.1/secrets" }),
      body: null,
      text: async () => "",
    }) as unknown as typeof fetch

    await expect(
      safeFetch("http://8.8.8.8", { allowHttp: true })
    ).rejects.toBeInstanceOf(BlockedUrlError)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it("rejects a response larger than the size cap via content-length", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers({ "content-length": String(5 * 1024 * 1024) }),
      body: null,
      text: async () => "x",
    }) as unknown as typeof fetch

    await expect(
      safeFetch("https://8.8.8.8", { maxBytes: 1024 })
    ).rejects.toBeInstanceOf(BlockedUrlError)
  })

  it("returns the body for an allowed public request", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      body: null,
      text: async () => "<html>hi</html>",
    }) as unknown as typeof fetch

    const result = await safeFetch("https://8.8.8.8")
    expect(result.ok).toBe(true)
    expect(result.text).toBe("<html>hi</html>")
  })
})
