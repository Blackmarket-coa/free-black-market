import * as React from "react"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `ReportSellerForm`'s submit handler, without a DOM.
 *
 * The storefront's vitest runs in `node` with no DOM library, so this calls the
 * component as a function with its hooks stubbed: `useState` records what the
 * handler sets, `handleSubmit` hands back the handler itself, and the data
 * layer is a mock. What it pins is the handler the form actually submits
 * through — that it files the report against the seller on the page, and that
 * a failed filing never reaches the confirmation. The old handler was
 * `logger.info('Form Data:', data)`; it would fail both.
 */

const { fileSellerReport, stateSets } = vi.hoisted(() => ({
  fileSellerReport: vi.fn(),
  stateSets: [] as { slot: number; value: unknown }[],
}))

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  let slot = 0
  return {
    ...actual,
    useState: (initial: unknown) => {
      const mine = slot++ % 2 // 0: submission state, 1: submit error
      return [initial, (value: unknown) => stateSets.push({ slot: mine, value })]
    },
  }
})

vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: () => ({}),
    handleSubmit: (fn: unknown) => fn,
    formState: { errors: {} },
    setValue: vi.fn(),
    clearErrors: vi.fn(),
  }),
}))

vi.mock("@/lib/data/seller-reports", () => ({ fileSellerReport }))
vi.mock("@/components/atoms", () => ({ Button: () => null, Input: () => null, Textarea: () => null }))
vi.mock("../SelectField/SelectField", () => ({ SelectField: () => null }))

import { ReportSellerForm } from "./ReportSellerForm"

// The storefront's vitest has no React plugin, so esbuild compiles JSX to the
// classic `React.createElement`, which reads a global `React`.
;(globalThis as { React?: typeof React }).React = React

type FormProps = { onSubmit: (data: unknown) => Promise<void> }

function findForm(node: ReactNode): ReactElement<FormProps> | null {
  if (!isValidElement(node)) return null
  if (node.type === "form") return node as ReactElement<FormProps>
  const children = (node.props as { children?: ReactNode }).children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findForm(child)
    if (found) return found
  }
  return null
}

function submit(data: Record<string, string>) {
  const tree = ReportSellerForm({ sellerId: "sel_on_page", onClose: () => {} })
  const form = findForm(tree)
  if (!form) throw new Error("ReportSellerForm rendered no form")
  return form.props.onSubmit(data)
}

const data = {
  reason: "trademark_copyright_dmca",
  comment: "This shop sells prints of artwork I hold the copyright to.",
  reporter_email: "rights@example.com",
}

beforeEach(() => {
  vi.clearAllMocks()
  stateSets.length = 0
})

describe("ReportSellerForm submit", () => {
  it("files the report against the seller whose page it is on", async () => {
    fileSellerReport.mockResolvedValue({ ok: true, id: "req_1" })

    await submit(data)

    expect(fileSellerReport).toHaveBeenCalledWith({ seller_id: "sel_on_page", ...data })
    expect(stateSets.filter((s) => s.slot === 0).map((s) => s.value)).toEqual([
      "submitting",
      "done",
    ])
  })

  it("stays on the form and shows the error when the filing fails", async () => {
    fileSellerReport.mockResolvedValue({ ok: false, message: "We could not submit your report." })

    await submit(data)

    const states = stateSets.filter((s) => s.slot === 0).map((s) => s.value)
    expect(states).not.toContain("done")
    expect(states.at(-1)).toBe("idle")
    expect(stateSets.filter((s) => s.slot === 1).map((s) => s.value).at(-1)).toBe(
      "We could not submit your report."
    )
  })
})
