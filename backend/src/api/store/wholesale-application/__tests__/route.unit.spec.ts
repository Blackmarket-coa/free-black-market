import { Modules } from "@medusajs/framework/utils"
import { VENDOR_RULES_MODULE } from "../../../../modules/vendor-rules"
import { EMAIL_TEMPLATES } from "../../../../modules/resend/templates"

jest.mock("../../../../lib/blackout-emit", () => ({
  emitBlackoutEvent: jest.fn(async () => null),
}))

import { POST } from "../route"
import { emitBlackoutEvent } from "../../../../lib/blackout-emit"

/**
 * The confirmation this public route emails must carry nothing the caller
 * wrote. The recipient is whatever address the body names, so a business or
 * contact name echoed into the email is a message of the caller's choosing,
 * sent from FBM's domain to a stranger.
 */

const PHISH = "Your account is locked, verify at http://evil.example"

function harness() {
  const createWholesaleApplication = jest.fn(async (data: Record<string, unknown>) => ({ id: "wapp_1", ...data }))
  const createNotifications = jest.fn(async () => [])
  const scope = {
    resolve(key: string) {
      if (key === VENDOR_RULES_MODULE) return { createWholesaleApplication }
      if (key === Modules.NOTIFICATION) return { createNotifications }
      throw new Error(`unexpected container key in spec: ${key}`)
    },
  }
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
  return { scope, res, createWholesaleApplication, createNotifications }
}

const validBody = {
  business_name: PHISH,
  contact_name: PHISH,
  email: "victim@example.com",
  phone: "555-0100",
  state: "mi",
  estimated_annual_volume_usd: 1000,
  species_interests: ["oak"],
}

describe("POST /store/wholesale-application", () => {
  it("stores the application and emails a confirmation that holds none of the request's text", async () => {
    const h = harness()
    await POST({ body: validBody, scope: h.scope } as never, h.res as never)

    expect(h.res.statusCode).toBe(201)
    expect(h.createWholesaleApplication).toHaveBeenCalledWith(
      expect.objectContaining({ business_name: PHISH, contact_name: PHISH, state: "MI" })
    )
    expect(h.createNotifications).toHaveBeenCalledTimes(1)
    const [sent] = h.createNotifications.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(sent).toEqual({
      to: "victim@example.com",
      channel: "email",
      template: EMAIL_TEMPLATES.WHOLESALE_APPLICATION_RECEIVED,
      data: {},
    })
    expect(JSON.stringify(sent)).not.toContain("evil.example")
    // The Hub still sees the business name, internally.
    expect(emitBlackoutEvent).toHaveBeenCalledWith(
      h.scope,
      "wholesale_application.received",
      expect.objectContaining({ businessName: PHISH }),
      expect.anything()
    )
  })

  it("sends nothing for an invalid email", async () => {
    const h = harness()
    await POST({ body: { ...validBody, email: "nope" }, scope: h.scope } as never, h.res as never)
    expect(h.res.statusCode).toBe(400)
    expect(h.createNotifications).not.toHaveBeenCalled()
  })
})
