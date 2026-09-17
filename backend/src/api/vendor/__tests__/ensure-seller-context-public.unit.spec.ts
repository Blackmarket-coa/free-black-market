import { ensureSellerContext } from "../_middlewares"

/**
 * `/vendor/**` is guarded by `ensureSellerContext` through a defineMiddlewares
 * entry (api/middlewares.ts). A route's own `export const AUTHENTICATE = false`
 * disables Medusa's authenticate middleware and does NOT reach that entry, so
 * an anonymous vendor route has to be named in this allowlist or it 401s.
 *
 * Email verification is necessarily anonymous — the caller is proving control
 * of a mailbox and has no seller to be in the context of — so this is the test
 * that keeps the registration flow reachable.
 */
function reqFor(path: string, method: string): any {
  return {
    originalUrl: path,
    url: path,
    path,
    method,
    headers: {},
    scope: { resolve: () => ({}) },
  }
}

function resStub(): any {
  const res: any = { statusCode: 200 }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res
}

describe("ensureSellerContext public allowlist", () => {
  it("lets an anonymous POST /vendor/verify-email through", async () => {
    const res = resStub()
    let calledNext = false
    await ensureSellerContext(reqFor("/vendor/verify-email", "POST"), res, () => {
      calledNext = true
    })
    expect(calledNext).toBe(true)
    expect(res.body).toBeUndefined()
  })

  it("still lets POST /vendor/sellers through", async () => {
    let calledNext = false
    await ensureSellerContext(reqFor("/vendor/sellers", "POST"), resStub(), () => {
      calledNext = true
    })
    expect(calledNext).toBe(true)
  })

  it("leaves the two inline-handled public routes alone", async () => {
    // These are public but never reach `next()`: registration-status 307s to
    // the auth surface and register is served by handleSellerRegistration right
    // here. What matters is that neither is rejected.
    const redirected: string[] = []
    const redirectRes: any = {
      ...resStub(),
      redirect: (_code: number, url: string) => redirected.push(url),
    }
    await ensureSellerContext(
      { ...reqFor("/vendor/registration-status", "GET"), protocol: "https" },
      redirectRes,
      () => {
        throw new Error("should not call next")
      }
    )
    expect(redirected[0]).toContain("/auth/seller/registration-status")
    expect(redirectRes.statusCode).not.toBe(401)
  })

  it("ignores the query string when matching", async () => {
    // The verification link carries ?request=..&token=.., and the panel may
    // forward them; a matcher that compared the raw URL would miss.
    let calledNext = false
    await ensureSellerContext(
      reqFor("/vendor/verify-email?request=req_1&token=abc", "POST"),
      resStub(),
      () => {
        calledNext = true
      }
    )
    expect(calledNext).toBe(true)
  })

  it("does not open the route to other methods, or open other routes", async () => {
    for (const [path, method] of [
      ["/vendor/verify-email", "GET"],
      ["/vendor/verify-email", "DELETE"],
      ["/vendor/products", "POST"],
      ["/vendor/orders", "GET"],
    ] as const) {
      let calledNext = false
      const res = resStub()
      await ensureSellerContext(reqFor(path, method), res, () => {
        calledNext = true
      })
      expect({ path, method, calledNext }).toEqual({ path, method, calledNext: false })
      expect(res.statusCode).toBe(401)
    }
  })
})
