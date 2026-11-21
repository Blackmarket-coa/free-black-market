import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { readFileSync } from "fs"
import { join } from "path"
import { renderToStaticMarkup } from "react-dom/server"
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

/**
 * SD-151 (5): registration asked for a website, Instagram and Facebook and
 * sent none of them, and the application the backend accepts has no field
 * for them, so the fields are gone. After filing, the page promised a
 * confirmation email; a store is approved by an organizer, and the emailed
 * verification link cannot work (SD-140).
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)
vi.mock("../../lib/logger", () => ({
  devLogger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createBackend, json, jwt } from "../../__tests__/backend"
import { useSignUpWithEmailPass } from "../../hooks/api/auth"

const backend = createBackend()
const page = readFileSync(join(__dirname, "register.tsx"), "utf8")

/** The top-level fields of the backend's registration schema, from its source. */
const acceptedFields = () => {
  const source = readFileSync(
    join(
      __dirname,
      "../../../../backend/src/api/vendor/register/validators.ts"
    ),
    "utf8"
  )
  const schema = /createSellerRegistrationSchema = z\.object\(\{([\s\S]*?)\n\}\)/.exec(
    source
  )
  expect(schema, "createSellerRegistrationSchema").not.toBeNull()
  return [...schema![1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]).sort()
}

const signUp = async (
  answers: Partial<Parameters<ReturnType<typeof useSignUpWithEmailPass>["mutateAsync"]>[0]>
) => {
  const hooks: { signUp?: ReturnType<typeof useSignUpWithEmailPass> } = {}
  const Probe = () => {
    hooks.signUp = useSignUpWithEmailPass()
    return null
  }
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>
  )
  await hooks.signUp!.mutateAsync({
    name: "Delta Hub",
    email: "Delta@Example.com",
    password: "Passw0rd!",
    confirmPassword: "Passw0rd!",
    ...answers,
  })
  return backend.sent.find((s) => s.path === "/auth/seller/register-request")!
}

beforeEach(() => {
  browser.store.clear()
  backend.reset()
  vi.stubGlobal("fetch", backend.fetch)
  backend.on("POST", "/auth/seller/emailpass/register", () =>
    json(200, { token: jwt({ actor_id: "", actor_type: "seller" }) })
  )
  backend.on("GET", "/auth/seller/registration-status", () =>
    json(200, { status: "no_request", message: "No registration request found." })
  )
  backend.on("POST", "/auth/seller/register-request", () =>
    json(201, {
      request: {
        id: "req_1",
        status: "pending",
        message:
          "Check your email and open the verification link to finish setting up your store.",
      },
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})
afterAll(() => browser.restore())

describe("the application the sign-up files", () => {
  it("has exactly the fields the backend's registration schema declares", async () => {
    const filed = await signUp({
      playbook: "hub",
      recommended_playbook: "hub",
      roles: ["hub"],
      resources: ["network", "transportation"],
      node_operator_opt_in: true,
    })

    expect(Object.keys(filed.body as object).sort()).toEqual(acceptedFields())
    expect(filed.body).toEqual({
      name: "Delta Hub",
      vendor_type: "mutual_aid",
      playbook: "hub",
      recommended_playbook: "hub",
      roles: ["hub"],
      resources: ["network", "transportation"],
      node_operator_opt_in: true,
      member: { name: "Delta Hub", email: "delta@example.com" },
    })
  })

  it("the backend's schema has no field for a website or social links", () => {
    for (const field of ["website_url", "social_links", "instagram", "facebook"]) {
      expect(acceptedFields()).not.toContain(field)
    }
  })

  it("signs nobody up to carry deliveries who did not tick it", async () => {
    const filed = await signUp({ playbook: "stall" })

    expect((filed.body as { node_operator_opt_in: boolean }).node_operator_opt_in).toBe(false)
  })
})

describe("the registration page", () => {
  it("asks for nothing it does not send", () => {
    for (const field of ["website_url", "instagram", "facebook"]) {
      expect(page).not.toContain(field)
    }
    expect(page).toContain(
      "You can add your website and social links in Settings, Store"
    )
  })

  it("says an organizer reviews new stores, and promises no email", () => {
    expect(page).toContain("An organizer reviews every new store")
    expect(page).toContain("You do not need to open a link from an email.")
    expect(page).not.toMatch(/confirmation email/i)
    expect(page).not.toMatch(/admin authorization/i)
  })
})
