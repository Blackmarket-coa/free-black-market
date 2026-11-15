import { readFileSync } from "fs"
import path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { medusaFetch } = vi.hoisted(() => ({ medusaFetch: vi.fn() }))

vi.mock("@/lib/config", () => ({ medusaFetch }))

import {
  SELLER_REPORT_FAILED_MESSAGE,
  SELLER_REPORT_RATE_LIMITED_MESSAGE,
  fileSellerReport,
} from "@/lib/data/seller-reports"

/**
 * The submit path behind `ReportSellerForm`, on every seller page.
 *
 * The form used to log the report to the browser console and then tell the
 * reporter it would be acted on. What matters here is that the report is
 * actually sent, and that a report the server did not accept can never come
 * back as `ok: true` — the form shows its confirmation only on `ok: true`.
 */

// Shape of the js-sdk's FetchError: message, statusText, status.
const fetchError = (status: number) =>
  Object.assign(new Error("refused"), { status, statusText: String(status) })

const input = {
  seller_id: "sel_real",
  reason: "trademark_copyright_dmca",
  comment: "  This shop sells prints of artwork I hold the copyright to.  ",
  reporter_email: " rights@example.com ",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("fileSellerReport", () => {
  it("posts the report to /store/seller-reports and returns the filed id", async () => {
    medusaFetch.mockResolvedValue({ id: "req_1", status: "pending" })

    expect(await fileSellerReport(input)).toEqual({ ok: true, id: "req_1" })
    expect(medusaFetch).toHaveBeenCalledTimes(1)
    const [route, options] = medusaFetch.mock.calls[0]
    expect(route).toBe("/store/seller-reports")
    expect(options.method).toBe("POST")
    expect(options.body).toEqual({
      seller_id: "sel_real",
      reason: "trademark_copyright_dmca",
      comment: "This shop sells prints of artwork I hold the copyright to.",
      reporter_email: "rights@example.com",
    })
  })

  it("sends no credentials: a rights-holder filing a notice need not have an account", async () => {
    medusaFetch.mockResolvedValue({ id: "req_1", status: "pending" })

    await fileSellerReport(input)

    expect(medusaFetch.mock.calls[0][1].headers).toBeUndefined()
  })

  it("leaves reporter_email out when none was given, rather than sending an empty string the server would refuse", async () => {
    medusaFetch.mockResolvedValue({ id: "req_2", status: "pending" })

    await fileSellerReport({ ...input, reporter_email: "   " })

    expect(medusaFetch.mock.calls[0][1].body).not.toHaveProperty("reporter_email")
  })

  it.each([400, 404, 500, 503])(
    "reports failure when the backend answers %i, so the form stays on the form",
    async (status) => {
      medusaFetch.mockRejectedValue(fetchError(status))

      expect(await fileSellerReport(input)).toEqual({
        ok: false,
        message: SELLER_REPORT_FAILED_MESSAGE,
      })
    }
  )

  it("reports failure on a network error", async () => {
    medusaFetch.mockRejectedValue(new TypeError("Failed to fetch"))

    expect(await fileSellerReport(input)).toEqual({
      ok: false,
      message: SELLER_REPORT_FAILED_MESSAGE,
    })
  })

  it("tells a rate-limited reporter to wait, rather than to retry at once", async () => {
    medusaFetch.mockRejectedValue(fetchError(429))

    expect(await fileSellerReport(input)).toEqual({
      ok: false,
      message: SELLER_REPORT_RATE_LIMITED_MESSAGE,
    })
  })

  it("does not count a success response with no report id as received", async () => {
    medusaFetch.mockResolvedValue({})

    expect(await fileSellerReport(input)).toEqual({
      ok: false,
      message: SELLER_REPORT_FAILED_MESSAGE,
    })
  })

  it("is not a server action, so the backend's per-IP cap sees the reporter's address", () => {
    // A "use server" module would send every report from the storefront's own
    // address, putting all reporters in one rate-limit bucket (SD-58).
    const source = readFileSync(path.resolve(__dirname, "../seller-reports.ts"), "utf8")
    expect(source).not.toMatch(/^\s*["']use server["']/m)
  })
})
