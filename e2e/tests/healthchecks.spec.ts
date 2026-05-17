import { expect, test } from "@playwright/test"

const STOREFRONT = process.env.STOREFRONT_URL || "http://localhost:3000"
const ADMIN = process.env.ADMIN_URL || "http://localhost:7000"
const VENDOR = process.env.VENDOR_URL || "http://localhost:7001"
const BACKEND = process.env.BACKEND_URL || "http://localhost:9000"

test.describe("healthchecks", () => {
  test("backend /health returns 200", async ({ request }) => {
    const r = await request.get(`${BACKEND}/health`)
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.status).toBe("ok")
  })

  test("backend /health/ready returns 200 when DB is up", async ({ request }) => {
    const r = await request.get(`${BACKEND}/health/ready`)
    expect([200, 503]).toContain(r.status())
  })

  test("storefront /api/health returns 200", async ({ request }) => {
    const r = await request.get(`${STOREFRONT}/api/health`)
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.status).toBe("ok")
  })

  test("admin-panel /healthz returns 200", async ({ request }) => {
    const r = await request.get(`${ADMIN}/healthz`)
    expect(r.status()).toBe(200)
    expect((await r.text()).trim()).toBe("ok")
  })

  test("vendor-panel /healthz returns 200", async ({ request }) => {
    const r = await request.get(`${VENDOR}/healthz`)
    expect(r.status()).toBe(200)
    expect((await r.text()).trim()).toBe("ok")
  })
})
