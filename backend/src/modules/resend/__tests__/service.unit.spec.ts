import { MedusaError } from "@medusajs/framework/utils"
// The email templates are .tsx and the unit jest config only transforms .ts;
// these tests exercise the send/retry transport, not rendering, so the shared
// renderer registry (which imports every template) is mocked to keep the
// service importable. Template coverage across both providers is
// ./email-template-coverage.unit.spec.ts.
jest.mock("../emails/registry", () => ({ EMAIL_TEMPLATE_RENDERERS: {} }))

import ResendNotificationProviderService from "../service"

type SendMock = jest.Mock

function makeService(retry: { maxAttempts?: number; baseDelayMs?: number } = {}) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any

  const svc = new ResendNotificationProviderService(
    { logger },
    {
      api_key: "re_test_key",
      from: "noreply@fbm.test",
      // String template avoids React rendering in these transport-level tests.
      html_templates: { "order-placed": { content: "<p>hi</p>" } },
      retry: { maxAttempts: 3, baseDelayMs: 0, ...retry },
    }
  )

  const send: SendMock = jest.fn()
  ;(svc as any).resendClient = { emails: { send } }
  return { svc, send, logger }
}

const notification = {
  to: "buyer@example.com",
  channel: "email",
  template: "order-placed",
  data: {},
} as any

const ok = { data: { id: "email_123" }, error: null }
const transient = { data: null, error: { name: "rate_limit_exceeded", message: "slow down" } }
const permanent = { data: null, error: { name: "validation_error", message: "bad recipient" } }

describe("ResendNotificationProviderService.send", () => {
  it("returns the message id on first-attempt success", async () => {
    const { svc, send } = makeService()
    send.mockResolvedValueOnce(ok)

    await expect(svc.send(notification)).resolves.toEqual({ id: "email_123" })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("retries a transient failure and then succeeds", async () => {
    const { svc, send, logger } = makeService()
    send.mockResolvedValueOnce(transient).mockResolvedValueOnce(ok)

    await expect(svc.send(notification)).resolves.toEqual({ id: "email_123" })
    expect(send).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it("does NOT retry a permanent failure", async () => {
    const { svc, send } = makeService()
    send.mockResolvedValueOnce(permanent)

    await expect(svc.send(notification)).rejects.toThrow(/bad recipient/)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("throws after exhausting retries on persistent transient failure", async () => {
    const { svc, send } = makeService({ maxAttempts: 3 })
    send.mockResolvedValue(transient)

    await expect(svc.send(notification)).rejects.toThrow(/Failed to send email/)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it("treats a thrown network error as transient and retries", async () => {
    const { svc, send } = makeService()
    send
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(ok)

    await expect(svc.send(notification)).resolves.toEqual({ id: "email_123" })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("retries a 5xx status code", async () => {
    const { svc, send } = makeService()
    send
      .mockResolvedValueOnce({
        data: null,
        error: { name: "internal_server_error", statusCode: 503, message: "down" },
      })
      .mockResolvedValueOnce(ok)

    await expect(svc.send(notification)).resolves.toEqual({ id: "email_123" })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("refuses an unknown template with INVALID_DATA instead of reporting it sent", async () => {
    // Returning `{}` here made Medusa mark the notification SUCCESS: a dropped
    // email that looked delivered.
    const { svc, send } = makeService()

    const sent = svc.send({ ...notification, template: "does-not-exist" })
    await expect(sent).rejects.toThrow(/Couldn't find an email template for does-not-exist/)
    await expect(sent).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    expect(send).not.toHaveBeenCalled()
  })
})
