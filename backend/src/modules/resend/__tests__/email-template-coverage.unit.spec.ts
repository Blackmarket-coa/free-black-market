/**
 * Every notification a caller in `src/` sends can actually be delivered.
 *
 * What this locks out (all found live, none of it failing anything):
 *   - `subscribers/order-placed.ts` sent `channel: "feed"`. No provider is
 *     registered for `feed`, so the call threw inside the subscriber's catch
 *     and no buyer ever got an order confirmation.
 *   - Six callers asked the `email` channel for templates neither provider
 *     had (`digital-order-template`, `seller-invitation`,
 *     `wholesale-application-received`, `wholesale-application-approved`,
 *     `wellness-automation`, `plant-demand-activated`). An unknown template
 *     was not refused: `send()` logged, returned `{}`, Medusa recorded the
 *     notification as sent, and nobody received it. Both providers now
 *     throw INVALID_DATA instead (their own specs), and this walk keeps
 *     every caller in `src/` on a template they know.
 *   - smtp, which wins when `SMTP_HOST` is set, had five of resend's nine
 *     templates, so four more were dropped only on smtp deployments.
 *
 * So this walks the source for every `.createNotifications(` call, reads its
 * `channel` and `template`, and checks the channel is one medusa-config
 * registers and that both email providers deliver every email template a
 * caller names. The providers' transports are mocked; no email is sent.
 *
 * Each `.tsx` template is replaced by a marker that records which file
 * rendered — which is what lets this check that template `x` is rendered by
 * `emails/x.tsx` and not merely by something. The real templates are
 * rendered in email-render.unit.spec.ts.
 */
import * as fs from "fs"
import * as path from "path"
import { EMAIL_TEMPLATES, EMAIL_TEMPLATE_NAMES } from "../templates"

const BACKEND = path.resolve(__dirname, "../../../..")
const SRC = path.join(BACKEND, "src")
const EMAILS_DIR = path.resolve(__dirname, "../emails")

type Marker = { __template: string; props: unknown }

// --- template markers (must run before the providers are required) --------

const TEMPLATE_FILES = fs
  .readdirSync(EMAILS_DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(/\.tsx$/, ""))
  .sort()

for (const base of TEMPLATE_FILES) {
  const source = fs.readFileSync(path.join(EMAILS_DIR, `${base}.tsx`), "utf8")
  const exportNames = [...source.matchAll(/^export const (\w+)\s*=/gm)].map((m) => m[1])
  // The real `.tsx` path, not a virtual extension-less one. Since the jest
  // config transforms `.tsx`, `./order-placed` resolves to the file, and the
  // resolver's cache is shared by every spec in a worker: a virtual mock at
  // the bare path was bypassed whenever email-render.unit.spec.ts had already
  // resolved the real file in the same worker, so this spec passed or failed
  // by run order.
  jest.doMock(path.join(EMAILS_DIR, `${base}.tsx`), () =>
    Object.fromEntries(
      exportNames.map((name) => [name, (props: unknown): Marker => ({ __template: base, props })])
    )
  )
}

jest.mock("@react-email/components", () => ({
  render: jest.fn(async (el: { __template?: string }) => `<html data-template="${el?.__template}"></html>`),
}))

jest.mock("resend", () => {
  const send = jest.fn()
  return { __esModule: true, Resend: jest.fn(() => ({ emails: { send } })), __mocks: { send } }
})

jest.mock("nodemailer", () => {
  const sendMail = jest.fn()
  const verify = jest.fn(async () => true)
  const createTransport = jest.fn(() => ({ sendMail, verify }))
  return { __esModule: true, createTransport, __mocks: { sendMail, verify } }
})

const { default: ResendNotificationProviderService } =
  require("../service") as typeof import("../service")
const { default: SMTPNotificationProviderService } =
  require("../../smtp/service") as typeof import("../../smtp/service")
const resendSend = (require("resend") as { __mocks: { send: jest.Mock } }).__mocks.send
const smtpSendMail = (require("nodemailer") as { __mocks: { sendMail: jest.Mock } }).__mocks.sendMail

// --- source walk -------------------------------------------------------------

type CallSite = {
  file: string
  channels: string[]
  templates: string[]
  nonLiteralChannel: boolean
  nonLiteralTemplate: string[]
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Blank out comments (keeping offsets and strings) so commented code is not read as a call. */
function stripComments(src: string): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " "
        i++
      }
      continue
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, " ")
      i = stop
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++
        j++
      }
      out += src.slice(i, j + 1)
      i = j + 1
      continue
    }
    out += c
    i++
  }
  return out
}

/** The argument text of the call whose `(` is at `open`, skipping strings. */
function callArguments(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++
        j++
      }
      i = j
      continue
    }
    if (c === "(") depth++
    if (c === ")") {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  throw new Error("unbalanced createNotifications call")
}

function resolveTemplateExpression(expr: string): string | null {
  const literal = expr.match(/^(["'`])([^"'`$]+)\1$/)
  if (literal) return literal[2]
  const constant = expr.match(/^EMAIL_TEMPLATES\.(\w+)$/)
  if (constant) return (EMAIL_TEMPLATES as Record<string, string>)[constant[1]] ?? `EMAIL_TEMPLATES.${constant[1]}`
  return null
}

/**
 * Splits a call's arguments into the notification objects' own keys and
 * whatever sits outside those objects.
 *
 * The notification objects are the shallowest `{...}` in the arguments. In
 * `keys`, anything nested deeper is blanked out:
 * `{ to, channel: "email", data: { ...order } }` becomes
 * `{ to, channel: "email", data:              }`. Reading keys at this level is
 * what lets a spread or a shorthand `template` be seen as a key rather than
 * confused with one inside `data`.
 *
 * `outside` is every other character. A literal object, or an array whose
 * elements are all literal objects, leaves only `[`, `]`, `,` and whitespace
 * there. Anything else is something the walk cannot read and could be another
 * notification: a variable element (`[{...}, other]`), an array-level spread
 * (`[{...}, ...xs.map(...)]`), a ternary (`cond ? {...} : payload`), a type
 * assertion. Before, only the shallowest-object text was read, so such a
 * caller parsed as its one literal and the rest vanished without failing.
 */
function splitNotificationObjects(args: string): { keys: string; outside: string } {
  const depthAt: number[] = []
  const inString: boolean[] = []
  let depth = 0
  for (let i = 0; i < args.length; i++) {
    const c = args[i]
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      while (j < args.length && args[j] !== c) {
        if (args[j] === "\\") j++
        j++
      }
      for (let k = i; k <= j && k < args.length; k++) {
        depthAt[k] = depth
        inString[k] = true
      }
      i = j
      continue
    }
    if (c === "{" || c === "[" || c === "(") {
      depth++
      depthAt[i] = depth
      continue
    }
    if (c === "}" || c === "]" || c === ")") {
      depthAt[i] = depth
      depth--
      continue
    }
    depthAt[i] = depth
  }
  let objectDepth = Infinity
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "{" && !inString[i] && depthAt[i] < objectDepth) objectDepth = depthAt[i]
  }
  // Each notification object runs from a `{` at objectDepth to the `}` that
  // closes it, which is the next brace back at objectDepth outside a string.
  const inObject: boolean[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "{" || inString[i] || depthAt[i] !== objectDepth) continue
    let j = i + 1
    while (j < args.length && !(args[j] === "}" && !inString[j] && depthAt[j] === objectDepth)) j++
    for (let k = i; k <= j && k < args.length; k++) inObject[k] = true
    i = j
  }
  let keys = ""
  let outside = ""
  for (let i = 0; i < args.length; i++) {
    const c = args[i]
    keys += (inObject[i] && depthAt[i] === objectDepth) || c === "\n" ? c : " "
    outside += inObject[i] ? " " : c
  }
  return { keys, outside }
}

/**
 * What one call's arguments say about its channel and template. Anything the
 * walk cannot read as a literal (or an `EMAIL_TEMPLATES.X` constant) lands in
 * `nonLiteralTemplate`, which fails the email check below: a computed
 * expression, a shorthand `template` property, a spread inside a notification
 * object that could carry the template, or an email call with no `template`
 * key at all. Reading only `template:` keys used to skip the last three
 * silently.
 *
 * Text outside the notification objects (see splitNotificationObjects) also
 * sets `nonLiteralChannel`, because the notification it may hold has a channel
 * nobody read. That is what makes it fail even when the literal beside it is
 * on another channel: `[{ channel: "seller_feed" }, ...emails]` is not an
 * email site, so a template flag alone would not reach the email check.
 */
function parseCallArguments(args: string): Omit<CallSite, "file"> {
  const { keys, outside } = splitNotificationObjects(args)
  const channels = [...keys.matchAll(/\bchannel\s*:\s*(["'`])([^"'`]+)\1/g)].map((x) => x[2])
  const channelKeys = [...keys.matchAll(/\bchannel\s*[:,}\n]/g)].length
  const templateExprs = [...keys.matchAll(/\btemplate\s*:\s*([^,\n}]+)/g)].map((x) => x[1].trim())
  const templates: string[] = []
  const nonLiteralTemplate: string[] = []
  for (const expr of templateExprs) {
    const value = resolveTemplateExpression(expr)
    if (value === null) nonLiteralTemplate.push(expr)
    else templates.push(value)
  }
  if (/(?:^|[{,])\s*template\s*(?=[,}]|$)/m.test(keys)) nonLiteralTemplate.push("shorthand `template`")
  if (/(?:^|[{,])\s*\.\.\./m.test(keys)) nonLiteralTemplate.push("a spread (`...`)")
  const unread = outside.replace(/[[\],\s]+/g, " ").trim()
  if (unread) {
    const shown = unread.length > 60 ? `${unread.slice(0, 57)}...` : unread
    nonLiteralTemplate.push(`outside the notification objects: \`${shown}\``)
  }
  if (channels.includes("email") && templateExprs.length === 0 && nonLiteralTemplate.length === 0) {
    nonLiteralTemplate.push("no `template` key")
  }
  return {
    channels,
    templates,
    nonLiteralChannel: channelKeys !== channels.length || channelKeys === 0 || unread.length > 0,
    nonLiteralTemplate,
  }
}

function findCallSites(): CallSite[] {
  const sites: CallSite[] = []
  for (const file of walk(SRC)) {
    const raw = fs.readFileSync(file, "utf8")
    if (!raw.includes("createNotifications")) continue
    const code = stripComments(raw)
    for (const m of code.matchAll(/\.createNotifications\s*\(/g)) {
      const args = callArguments(code, (m.index ?? 0) + m[0].length - 1)
      sites.push({ file: path.relative(BACKEND, file), ...parseCallArguments(args) })
    }
  }
  return sites
}

function registeredChannels(): Set<string> {
  const config = fs.readFileSync(path.join(BACKEND, "medusa-config.ts"), "utf8")
  const channels = new Set<string>()
  for (const m of config.matchAll(/channels\s*:\s*\[([^\]]*)\]/g)) {
    for (const c of m[1].matchAll(/(["'`])([^"'`]+)\1/g)) channels.add(c[2])
  }
  return channels
}

const SITES = findCallSites()
const CHANNELS = registeredChannels()
const EMAIL_SITES = SITES.filter((s) => s.channels.includes("email"))
const CALLER_EMAIL_TEMPLATES = [...new Set(EMAIL_SITES.flatMap((s) => s.templates))].sort()

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never
}

const providers = [
  {
    name: "resend",
    make: () =>
      new ResendNotificationProviderService({ logger: makeLogger() }, {
        api_key: "re_test_key",
        from: "noreply@fbm.test",
        retry: { maxAttempts: 1, baseDelayMs: 0 },
      }),
  },
  {
    name: "smtp",
    make: () =>
      new SMTPNotificationProviderService(
        { logger: makeLogger() },
        {
          host: "smtp.fbm.test",
          port: 587,
          auth: { user: "mailer", pass: "CHANGE_ME_SMTP_TEST_PASSWORD" },
          from: "noreply@fbm.test",
        }
      ),
  },
]

describe("notification callers", () => {
  it("the walk finds the callers it is meant to check", () => {
    // Guards the regexes: a walk that finds nothing would pass every check below.
    expect(EMAIL_SITES.length).toBeGreaterThanOrEqual(10)
    expect(SITES).toContainEqual(
      expect.objectContaining({
        file: "src/subscribers/order-placed.ts",
        channels: ["email"],
        templates: ["order-placed"],
      })
    )
    expect(CHANNELS).toEqual(new Set(["seller_feed", "email"]))
  })

  it("every call names its channel literally, and the channel has a registered provider", () => {
    const unreadable = SITES.filter((s) => s.nonLiteralChannel).map(
      (s) => `${s.file}${s.nonLiteralTemplate.length ? `: ${s.nonLiteralTemplate.join(", ")}` : ""}`
    )
    expect(unreadable).toEqual([])

    const unrouted = SITES.flatMap((s) =>
      s.channels.filter((c) => !CHANNELS.has(c)).map((c) => `${s.file}: channel "${c}"`)
    )
    expect(unrouted).toEqual([])
  })

  it("every email call names a template both providers know", () => {
    const unreadable = EMAIL_SITES.filter((s) => s.nonLiteralTemplate.length).map(
      (s) => `${s.file}: template ${s.nonLiteralTemplate.join(", ")}`
    )
    expect(unreadable).toEqual([])

    const unknown = EMAIL_SITES.flatMap((s) =>
      s.templates
        .filter((t) => !(EMAIL_TEMPLATE_NAMES as readonly string[]).includes(t))
        .map((t) => `${s.file}: template "${t}"`)
    )
    expect(unknown).toEqual([])
  })
})

describe("the call-site parser reads what a caller can write", () => {
  const parse = (args: string) => parseCallArguments(args)

  it("reads a literal template and a constant", () => {
    expect(parse(`{ to, channel: "email", template: "order-placed", data: {} }`)).toMatchObject({
      channels: ["email"],
      templates: ["order-placed"],
      nonLiteralTemplate: [],
      nonLiteralChannel: false,
    })
    expect(parse(`{ to, channel: "email", template: EMAIL_TEMPLATES.ORDER_PLACED, data }`).nonLiteralTemplate).toEqual([])
  })

  it("does not mistake a spread or a template key inside data for the notification's own", () => {
    const site = parse(`{ to, channel: "email", template: "order-placed", data: { ...order, template: x } }`)
    expect(site.templates).toEqual(["order-placed"])
    expect(site.nonLiteralTemplate).toEqual([])
  })

  it("reads each notification in an array", () => {
    const site = parse(`[{ to: a, channel: "email", template: "order-placed" }, { to: b, channel: "feed", template: "admin-ui" }]`)
    expect(site.channels).toEqual(["email", "feed"])
    expect(site.templates).toEqual(["order-placed", "admin-ui"])
    expect(site.nonLiteralChannel).toBe(false)
    expect(site.nonLiteralTemplate).toEqual([])
  })

  it("reads an array of literals laid out over lines with a trailing comma", () => {
    const site = parse(`
      [
        { to: a, channel: "email", template: "order-placed" },
        { to: b, channel: "email", template: EMAIL_TEMPLATES.ORDER_PLACED },
      ]
    `)
    expect(site.templates).toEqual(["order-placed", "order-placed"])
    expect(site.nonLiteralChannel).toBe(false)
    expect(site.nonLiteralTemplate).toEqual([])
  })

  // The walk keeps the notification objects' own keys. Anything else in the
  // arguments could be another notification it cannot read, so beside a
  // literal object it must fail, not vanish: before, each of these parsed as
  // the literal alone, and an email to `nope-unknown` passed green.
  it.each([
    ["a variable beside a literal in an array", `[{ to: a, channel: "email", template: "order-placed" }, other]`, "other"],
    [
      "an array-level spread of mapped notifications",
      `[{ channel: "seller_feed", template: "x" }, ...recipients.map((r) => ({ to: r, channel: "email", template: "nope-unknown" }))]`,
      "...recipients.map(",
    ],
    ["a ternary with a variable branch", `isX ? { channel: "email", template: "order-placed" } : payload`, "isX ?"],
    [
      "a conditional array spread",
      `[{ channel: "email", template: "order-placed" }, ...(flag ? [{ channel: "email", template: "bogus2" }] : [])]`,
      "...(flag ?",
    ],
    ["a parenthesised element at the objects' own depth", `[{ channel: "email", template: "order-placed" }, (other)]`, "(other)"],
    ["a nested array element", `[{ channel: "email", template: "order-placed" }, [other]]`, "other"],
    ["a type assertion", `{ to, channel: "email", template: "order-placed" } as Payload`, "as Payload"],
  ])("flags %s instead of reading only the literal", (_label, args, snippet) => {
    const site = parse(args)
    expect(site.nonLiteralChannel).toBe(true)
    const outside = site.nonLiteralTemplate.find((r) => r.startsWith("outside the notification objects"))
    expect(outside).toBeDefined()
    expect(outside).toContain(snippet)
  })

  it.each([
    ["a variable", `{ to, channel: "email", template: name, data: {} }`, "name"],
    ["a shorthand property", `{ to, channel: "email", template, data: {} }`, "shorthand `template`"],
    ["a shorthand property last", `{ to, channel: "email", template }`, "shorthand `template`"],
    ["a spread", `{ ...base, to, channel: "email", data: {} }`, "a spread (`...`)"],
    ["no template key", `{ to, channel: "email", data: {} }`, "no `template` key"],
  ])("flags %s as unreadable instead of skipping it", (_label, args, reason) => {
    expect(parse(args).nonLiteralTemplate).toContain(reason)
  })

  it("flags a channel it cannot read", () => {
    expect(parse(`{ to, channel, template: "order-placed" }`).nonLiteralChannel).toBe(true)
    expect(parse(`{ to, channel: kind, template: "order-placed" }`).nonLiteralChannel).toBe(true)
    expect(parse(`notifications`).nonLiteralChannel).toBe(true)
  })
})

describe("email template registry", () => {
  it("has exactly one template file per name, named after it", () => {
    expect([...EMAIL_TEMPLATE_NAMES].sort()).toEqual(TEMPLATE_FILES)
  })

  describe.each(providers)("$name provider", ({ make }) => {
    it.each([...EMAIL_TEMPLATE_NAMES])("renders %s with its own file and subject", (name) => {
      const svc = make()
      const renderer = svc.getTemplate(name)
      expect(typeof renderer).toBe("function")
      expect((renderer as unknown as (p: unknown) => Marker)({})).toMatchObject({ __template: name })
      expect(svc.getTemplateSubject(name)).not.toBe("New Email")
    })
  })
})

describe.each(providers)("$name provider delivers every template a caller sends", ({ name, make }) => {
  beforeEach(() => {
    resendSend.mockReset().mockResolvedValue({ data: { id: "email_1" }, error: null })
    smtpSendMail.mockReset().mockResolvedValue({ messageId: "msg_1" })
  })

  it.each(CALLER_EMAIL_TEMPLATES)("%s", async (template) => {
    const svc = make()
    const data = { probe: template }

    const result = await svc.send({ to: "someone@example.com", channel: "email", template, data } as never)

    // An id, not `{}` (the old silent drop) and not a throw (an unknown template now).
    expect(result).toEqual({ id: name === "resend" ? "email_1" : "msg_1" })
    if (name === "resend") {
      expect(resendSend).toHaveBeenCalledTimes(1)
      expect(resendSend.mock.calls[0][0]).toMatchObject({
        to: ["someone@example.com"],
        react: { __template: template, props: data },
      })
    } else {
      expect(smtpSendMail).toHaveBeenCalledTimes(1)
      expect(smtpSendMail.mock.calls[0][0]).toMatchObject({
        to: "someone@example.com",
        html: `<html data-template="${template}"></html>`,
      })
    }
  })
})
