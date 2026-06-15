import {
  isAllowedOrigin,
  enforceSameOriginForCookieAuth,
} from "../csrf-guard"

const ALLOWED = "https://admin.shop.example"

function makeReq(overrides: Record<string, unknown> = {}): any {
  return {
    method: "POST",
    path: "/admin/products",
    headers: {},
    ...overrides,
  }
}

function makeRes(): any {
  const res: any = { statusCode: 200 }
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = jest.fn((body: unknown) => {
    res.body = body
    return res
  })
  return res
}

describe("csrf-guard", () => {
  const saved = process.env

  beforeEach(() => {
    process.env = {
      ...saved,
      NODE_ENV: "production",
      ADMIN_CORS: ALLOWED,
      VENDOR_CORS: "",
      STORE_CORS: "",
      AUTH_CORS: "",
    } as NodeJS.ProcessEnv
  })

  afterEach(() => {
    process.env = saved
  })

  describe("isAllowedOrigin", () => {
    it("accepts a configured CORS origin", () => {
      expect(isAllowedOrigin(ALLOWED)).toBe(true)
      expect(isAllowedOrigin(ALLOWED + "/")).toBe(true)
    })

    it("accepts an always-trusted marketplace subdomain", () => {
      expect(isAllowedOrigin("https://admin.freeblackmarket.com")).toBe(true)
    })

    it("rejects an unknown origin and malformed input", () => {
      expect(isAllowedOrigin("https://evil.example")).toBe(false)
      expect(isAllowedOrigin("not-a-url")).toBe(false)
      expect(isAllowedOrigin(undefined)).toBe(false)
    })

    it("allows railway preview origins only outside production", () => {
      process.env.NODE_ENV = "production"
      expect(isAllowedOrigin("https://preview.up.railway.app")).toBe(false)
      process.env.NODE_ENV = "development"
      expect(isAllowedOrigin("https://preview.up.railway.app")).toBe(true)
    })
  })

  describe("enforceSameOriginForCookieAuth", () => {
    it("passes safe methods without checks", () => {
      const next = jest.fn()
      const res = makeRes()
      enforceSameOriginForCookieAuth(
        makeReq({ method: "GET", headers: { cookie: "sid=1" } }),
        res,
        next
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    it("exempts bearer-authenticated requests even with a cookie", () => {
      const next = jest.fn()
      const res = makeRes()
      enforceSameOriginForCookieAuth(
        makeReq({
          headers: { cookie: "sid=1", authorization: "Bearer abc.def" },
        }),
        res,
        next
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    it("exempts requests with no cookie (no ambient credential)", () => {
      const next = jest.fn()
      const res = makeRes()
      enforceSameOriginForCookieAuth(makeReq({ headers: {} }), res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    it("allows a cookie write from an allowed Origin", () => {
      const next = jest.fn()
      const res = makeRes()
      enforceSameOriginForCookieAuth(
        makeReq({ headers: { cookie: "sid=1", origin: ALLOWED } }),
        res,
        next
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    it("allows a cookie write when only a same-site Referer is present", () => {
      const next = jest.fn()
      const res = makeRes()
      enforceSameOriginForCookieAuth(
        makeReq({
          headers: { cookie: "sid=1", referer: `${ALLOWED}/products/new` },
        }),
        res,
        next
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    it("blocks a cookie write from a disallowed Origin", () => {
      const next = jest.fn()
      const res = makeRes()
      enforceSameOriginForCookieAuth(
        makeReq({
          headers: { cookie: "sid=1", origin: "https://evil.example" },
        }),
        res,
        next
      )
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.body).toMatchObject({ code: "csrf_origin_rejected" })
    })

    it("blocks a cookie write with neither Origin nor Referer", () => {
      const next = jest.fn()
      const res = makeRes()
      enforceSameOriginForCookieAuth(
        makeReq({ headers: { cookie: "sid=1" } }),
        res,
        next
      )
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })
})
