import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * SD-151 (5): behind VITE_FBM_QUICK_ONBOARD, the quick path's "Continue to
 * delivery" went to "/onboarding?step=step_3". The onboarding route shows the
 * quick path for every address without `mode=full`, so the button reloaded
 * the page it was on. It now goes to the full wizard, which opens at the step
 * the backend recorded.
 */

vi.mock("../../components/onboarding", async () => ({
  LaunchWizard: () => "FULL WIZARD",
  QuickPath: () => "QUICK PATH",
}))
// The quick path's own module is imported only for the address it goes to.
vi.mock("../../hooks/api/playbook", () => ({
  usePlaybookAssignment: () => ({ data: undefined, isPending: true }),
  useAssignPlaybook: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { QUICK_PATH_NEXT } from "../../components/onboarding/quick-path"
import { Onboarding, showsQuickPath } from "./onboarding"

const searchOf = (address: string) =>
  new URL(address, "http://panel.test").search

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("/onboarding with the quick path switched on", () => {
  it("shows the quick path, and the full wizard at the address the quick path continues to", () => {
    expect(showsQuickPath(true, searchOf("/onboarding"))).toBe(true)
    // Where "Continue to delivery" used to go: the quick path again.
    expect(showsQuickPath(true, searchOf("/onboarding?step=step_3"))).toBe(true)

    expect(QUICK_PATH_NEXT.startsWith("/onboarding")).toBe(true)
    expect(showsQuickPath(true, searchOf(QUICK_PATH_NEXT))).toBe(false)
  })
})

describe("/onboarding with the quick path off, as it is unless the build sets the flag", () => {
  it("shows the full wizard at every address", () => {
    expect(showsQuickPath(false, searchOf("/onboarding"))).toBe(false)

    vi.stubGlobal("window", { location: { search: "" } })
    expect(renderToStaticMarkup(<Onboarding />)).toBe("FULL WIZARD")
  })
})
