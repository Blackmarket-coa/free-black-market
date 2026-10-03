// Mirrors ../../resend/__tests__/service.unit.spec.ts: the email templates are
// .tsx and the unit jest config only transforms .ts, so the five templates this
// service imports from ../resend/emails are virtually mocked. These tests
// exercise the transport contract and send/error paths, not rendering.
jest.mock("../../resend/emails/order-placed", () => ({ orderPlacedEmail: () => null }), { virtual: true })
jest.mock("../../resend/emails/user-invited", () => ({ userInvitedEmail: () => null }), { virtual: true })
jest.mock("../../resend/emails/password-reset", () => ({ passwordResetEmail: () => null }), { virtual: true })
jest.mock("../../resend/emails/vendor-accepted", () => ({ vendorAcceptedEmail: () => null }), { virtual: true })
jest.mock("../../resend/emails/customer-accepted", () => ({ customerAcceptedEmail: () => null }), { virtual: true })

// The transport is mocked for the behavioural tests below. The mock fns are
// created inside the factory and read back off the mocked module, which avoids
// the hoisting trap where a factory references a const that has not been
// initialised yet.
jest.mock("nodemailer", () => {
  const sendMail = jest.fn()
  const verify = jest.fn()
  const createTransport = jest.fn(() => ({ sendMail, verify }))
  return { __esModule: true, createTransport, __mocks: { sendMail, verify } }
})

import * as nodemailer from "nodemailer"
import SMTPNotificationProviderService from "../service"

const createTransport = (nodemailer as unknown as { createTransport: jest.Mock }).createTransport
const { sendMail, verify } = (nodemailer as unknown as {
  __mocks: { sendMail: jest.Mock; verify: jest.Mock }
}).__mocks

const flush = () => new Promise((resolve) => setImmediate(resolve))

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any
}

const baseOptions = {
  host: "smtp.fbm.test",
  port: 587,
  // CHANGE_ME_ is the repo's allowlisted placeholder shape (.gitguardian.yaml,
  // .gitleaks.toml): a fixture password that looks real trips GitGuardian's
  // SMTP-credentials detector, and the App applies the __tests__ path ignore
  // only from the default branch, so the string itself has to be a placeholder.
  auth: { user: "mailer", pass: "CHANGE_ME_SMTP_TEST_PASSWORD" },
  from: "noreply@fbm.test",
  // A string template avoids React rendering in these transport-level tests.
  html_templates: { "order-placed": { content: "<p>hi</p>", subject: "Your order" } },
}

const notification = {
  to: "buyer@example.com",
  channel: "email",
  template: "order-placed",
  data: {},
} as any

beforeEach(() => {
  jest.clearAllMocks()
  verify.mockResolvedValue(true)
})

describe("SMTPNotificationProviderService transport construction", () => {
  it("builds the transport from host/port/auth and verifies the connection", async () => {
    const logger = makeLogger()
    new SMTPNotificationProviderService({ logger }, baseOptions)
    await flush()

    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.fbm.test",
      port: 587,
      secure: false,
      auth: { user: "mailer", pass: "CHANGE_ME_SMTP_TEST_PASSWORD" },
    })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith("SMTP connection verified successfully")
  })

  it("defaults `secure` to true on port 465 and honours an explicit value elsewhere", () => {
    new SMTPNotificationProviderService({ logger: makeLogger() }, { ...baseOptions, port: 465 })
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 465, secure: true }))

    new SMTPNotificationProviderService(
      { logger: makeLogger() },
      { ...baseOptions, port: 587, secure: true }
    )
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 587, secure: true }))
  })

  it("logs a failed connection check instead of throwing from the constructor", async () => {
    const logger = makeLogger()
    const boom = new Error("ECONNREFUSED")
    verify.mockRejectedValueOnce(boom)

    expect(() => new SMTPNotificationProviderService({ logger }, baseOptions)).not.toThrow()
    await flush()

    expect(logger.error).toHaveBeenCalledWith("SMTP connection verification failed:", boom)
  })
})

describe("SMTPNotificationProviderService.send", () => {
  it("posts the rendered html through the transport and returns the message id", async () => {
    const svc = new SMTPNotificationProviderService({ logger: makeLogger() }, baseOptions)
    sendMail.mockResolvedValueOnce({ messageId: "<abc123@fbm.test>" })

    await expect(svc.send(notification)).resolves.toEqual({ id: "<abc123@fbm.test>" })

    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledWith({
      from: "noreply@fbm.test",
      to: "buyer@example.com",
      subject: "Your order",
      html: "<p>hi</p>",
    })
  })

  it("falls back to the built-in subject when the template does not set one", async () => {
    const svc = new SMTPNotificationProviderService(
      { logger: makeLogger() },
      { ...baseOptions, html_templates: { "order-placed": { content: "<p>hi</p>" } } }
    )
    sendMail.mockResolvedValueOnce({ messageId: "x" })

    await svc.send(notification)

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: "Order Confirmation" }))
  })

  it("wraps a transport failure in a MedusaError that keeps the upstream message", async () => {
    const logger = makeLogger()
    const svc = new SMTPNotificationProviderService({ logger }, baseOptions)
    sendMail.mockRejectedValueOnce(new Error("Connection timed out"))

    await expect(svc.send(notification)).rejects.toThrow(/Failed to send email: Connection timed out/)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send email to buyer@example.com"),
      expect.any(Error)
    )
  })

  it("adds the credentials hint when the server rejects the login", async () => {
    const logger = makeLogger()
    const svc = new SMTPNotificationProviderService({ logger }, baseOptions)
    sendMail.mockRejectedValueOnce(new Error("Invalid login: 535 Authentication failed"))

    await expect(svc.send(notification)).rejects.toThrow(/Invalid login/)
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("SMTP AUTHENTICATION FAILED"))
  })

  it("returns empty and never touches the transport for an unknown template", async () => {
    const logger = makeLogger()
    const svc = new SMTPNotificationProviderService({ logger }, baseOptions)

    await expect(svc.send({ ...notification, template: "does-not-exist" })).resolves.toEqual({})

    expect(sendMail).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't find an email template"))
  })
})

describe("SMTPNotificationProviderService.validateOptions", () => {
  const valid = { host: "h", port: 25, auth: { user: "u", pass: "p" }, from: "f@x" }

  it.each([
    ["host", { ...valid, host: undefined }],
    ["port", { ...valid, port: undefined }],
    ["auth.user", { ...valid, auth: { pass: "p" } }],
    ["auth.pass", { ...valid, auth: { user: "u" } }],
    ["from", { ...valid, from: undefined }],
  ])("rejects options missing `%s`", (key, options) => {
    expect(() => SMTPNotificationProviderService.validateOptions(options as any)).toThrow(
      new RegExp(`Option \`${key.replace(".", "\\.")}\` is required`)
    )
  })

  it("accepts a complete set of options", () => {
    expect(() => SMTPNotificationProviderService.validateOptions(valid)).not.toThrow()
  })
})

// Everything above runs against a mocked transport, which proves the service's
// behaviour but says nothing about the real nodemailer module's shape — and the
// shape was the risk when nodemailer moved 9 -> 10 (docs/AUDIT_DEBT.md SD-27).
// This block loads the real installed module once and asserts the three symbols
// the service relies on. createTransport does not open a connection, so this
// needs no network.
describe("installed nodemailer satisfies the contract this service relies on", () => {
  const actual = jest.requireActual("nodemailer") as typeof import("nodemailer")
  const pkg = jest.requireActual("nodemailer/package.json") as { version: string }

  it("exports createTransport, and the transport exposes sendMail and verify", () => {
    expect(typeof actual.createTransport).toBe("function")
    const transport = actual.createTransport({
      host: "localhost",
      port: 587,
      secure: false,
      auth: { user: "u", pass: "p" },
    })
    expect(typeof transport.sendMail).toBe("function")
    expect(typeof transport.verify).toBe("function")
  })

  it("is on the 10.x line or later — the 9.x line stopped receiving fixes (SD-27)", () => {
    // GHSA-prgh-xp8r-p3m5 (fixed 10.0.5) and GHSA-v53p-9fqp-m79j (fixed 10.0.6)
    // have no 9.x backport, so a downgrade below 10 silently reintroduces both.
    const major = Number(pkg.version.split(".")[0])
    expect(major).toBeGreaterThanOrEqual(10)
  })
})
