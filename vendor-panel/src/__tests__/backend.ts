import { vi } from "vitest"

/**
 * A stand-in for the backend, for specs that drive the panel's hooks and
 * screens with a mocked `fetch`: it records every request and answers by
 * method and path.
 *
 *   const backend = createBackend()
 *   beforeEach(() => {
 *     backend.reset()
 *     vi.stubGlobal("fetch", backend.fetch)
 *   })
 *   backend.on("POST", "/vendor/stock-locations", () => json(201, { ... }))
 *
 * A request no route answers gets a 404 naming it, so a call the code was not
 * expected to make fails the test that made it instead of passing quietly.
 */

export type Sent = {
  method: string
  path: string
  query: Record<string, string>
  headers: Headers
  /** The parsed JSON body, the FormData as sent, or undefined. */
  body: unknown
}

type Reply = (sent: Sent) => Response | Promise<Response>

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

/** A JWT with this payload: only the payload is read by the panel. */
export const jwt = (payload: Record<string, unknown>) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url"
    ),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".")

export const createBackend = () => {
  const sent: Sent[] = []
  let routes: Array<{ method: string; path: string | RegExp; reply: Reply }> =
    []

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://panel.test")
    const raw = init?.body
    const record: Sent = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: new Headers(init?.headers),
      body: typeof raw === "string" ? JSON.parse(raw) : (raw ?? undefined),
    }
    sent.push(record)
    // The route registered last wins, so a test can replace an answer.
    const route = [...routes]
      .reverse()
      .find(
        (r) =>
          r.method === record.method &&
          (typeof r.path === "string"
            ? r.path === record.path
            : r.path.test(record.path))
      )
    return route
      ? route.reply(record)
      : json(404, {
          message: `no route for ${record.method} ${record.path}`,
        })
  })

  return {
    sent,
    fetch,
    on: (method: string, path: string | RegExp, reply: Reply) => {
      routes.push({ method, path, reply })
    },
    /** The requests as "METHOD /path", in the order they were sent. */
    calls: () => sent.map((s) => `${s.method} ${s.path}`),
    reset: () => {
      sent.length = 0
      routes = []
      fetch.mockClear()
    },
  }
}
