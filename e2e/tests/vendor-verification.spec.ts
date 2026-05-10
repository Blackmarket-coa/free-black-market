import { expect, test } from "@playwright/test"

/**
 * §5.1 foundation milestone — vendor verification + signing
 * instrumentation smoke. Confirms the new admin funnel route returns
 * the documented shape and the new entitlements endpoints are wired.
 *
 * Operates against a running stack (`docker compose up`) and a backend
 * exposing /admin/vendor-verification/funnel without auth (current
 * pattern in this repo). Adjust auth once admin auth is layered on.
 */

const BACKEND = process.env.BACKEND_URL || "http://localhost:9000"

test.describe("§5.1 vendor verification funnel", () => {
  test("GET /admin/vendor-verification/funnel returns the documented shape", async ({ request }) => {
    const r = await request.get(`${BACKEND}/admin/vendor-verification/funnel`)
    if (r.status() === 401 || r.status() === 403) {
      test.skip(true, "admin auth required in this environment; covered by unit test")
    }
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(typeof body.total).toBe("number")
    expect(body.by_status).toBeDefined()
    expect(body.by_level).toBeDefined()
    expect(["number", "object"]).toContain(typeof body.median_time_to_verify_ms)
  })

  test("entitlements economic-standing returns 503 when integration disabled, or zeroed totals when MXID is unknown", async ({ request }) => {
    const r = await request.get(
      `${BACKEND}/v1/integrations/blackout/entitlements/economic-standing?mxid=@e2e-unknown:bmc.example`,
      {
        headers: {
          Authorization: "Bearer test-token-not-real",
        },
      }
    )
    // Acceptable outcomes: 503 (integration disabled), 401 (token rejected), or
    // 200 with zeroed totals when integration is enabled and the token
    // is a valid Blackout-issued JWT.
    expect([200, 401, 503]).toContain(r.status())
    if (r.status() === 200) {
      const body = await r.json()
      expect(body.coalition_credits).toBeDefined()
      expect(body.coalition_credits.available).toBe(0)
      expect(body.coalition_credits.pending).toBe(0)
    }
  })
})
