import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * SD-151 (5): a rejected applicant was told to contact support and nothing
 * else. Applying again from /register works: the sign-up signs in to the
 * existing login with its password and files a new application.
 */

const browser = await vi.hoisted(async () =>
  (await import("../../__tests__/browser-storage")).installBrowserStorage()
)
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  Navigate: () => null,
  Link: ({ to, children }: { to: string; children?: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}))

import { usersQueryKeys } from "../../hooks/api/users"
import { setAuthToken } from "../../lib/client"
import { PendingApproval } from "./pending-approval"

const pageFor = (status: Record<string, unknown>) => {
  const client = new QueryClient()
  client.setQueryData(usersQueryKeys.registrationStatus(), status)
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PendingApproval />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  browser.store.clear()
  setAuthToken("tok-applicant")
})
afterAll(() => browser.restore())

describe("the page an applicant waits on", () => {
  it("tells a rejected applicant they can apply again, with the reviewer's note and a way there", () => {
    const html = pageFor({
      status: "rejected",
      message: "Your registration request was rejected.",
      reviewer_note: "Please use your trading name.",
    })

    expect(html).toContain("Registration Not Approved")
    expect(html).toContain("Note: Please use your trading name.")
    expect(html).toContain(
      "You can apply again with the same email and password"
    )
    expect(html).toMatch(/<a href="\/register"[^>]*>.*Apply again/s)
  })

  it("gives a cancelled applicant the same way back", () => {
    expect(
      pageFor({ status: "cancelled", message: "Cancelled." })
    ).toMatch(/<a href="\/register"[^>]*>.*Apply again/s)
  })

  it("offers a pending applicant no second application", () => {
    const html = pageFor({ status: "pending", message: "Pending." })

    expect(html).toContain("Pending Approval")
    expect(html).not.toContain("Apply again")
  })
})
