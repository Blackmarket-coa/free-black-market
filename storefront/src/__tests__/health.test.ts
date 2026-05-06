import { describe, expect, it } from "vitest"
import { GET } from "../app/api/health/route"

describe("storefront /api/health route", () => {
  it("responds with status ok", async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe("ok")
    expect(body.service).toBe("freeblackmarket-storefront")
  })
})
