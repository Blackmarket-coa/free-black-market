import type { ComponentProps } from "react"
import { vi } from "vitest"

/**
 * Lets a spec read and press the buttons a screen renders without a DOM, as
 * routes/finances/record-payment.spec.tsx does: every `Button` from
 * `@medusajs/ui` is recorded with its props while the real one still renders,
 * and `toast` is replaced by spies.
 *
 *   const ui = await vi.hoisted(async () =>
 *     (await import("../../__tests__/ui-capture")).createUiCapture()
 *   )
 *   vi.mock("@medusajs/ui", async (importOriginal) =>
 *     ui.mock(await importOriginal<typeof import("@medusajs/ui")>())
 *   )
 */

type CapturedButton = {
  children?: unknown
  disabled?: boolean
  isLoading?: boolean
  onClick?: () => unknown
}

/** The text of a button's children: strings, and strings inside fragments. */
const labelOf = (children: unknown): string => {
  if (typeof children === "string") return children
  if (Array.isArray(children)) return children.map(labelOf).join("")
  return ""
}

export const createUiCapture = () => {
  const buttons: CapturedButton[] = []
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }

  return {
    buttons,
    toast,
    mock: async (actual: typeof import("@medusajs/ui")) => {
      const { createElement } = await import("react")
      return {
        ...actual,
        toast,
        Button: (props: ComponentProps<typeof actual.Button>) => {
          buttons.push(props as CapturedButton)
          return createElement(actual.Button, props)
        },
      }
    },
    /** The button whose label contains `label`, from the last render. */
    button: (label: string) => {
      const found = buttons.filter((b) => labelOf(b.children).includes(label))
      if (found.length === 0) {
        throw new Error(
          `no button labelled "${label}" among: ${buttons
            .map((b) => labelOf(b.children))
            .join(" | ")}`
        )
      }
      return found[found.length - 1]
    },
    has: (label: string) =>
      buttons.some((b) => labelOf(b.children).includes(label)),
    /** A browser fires no click on a disabled button, and Medusa's is disabled while loading. */
    press: (button: CapturedButton) => {
      if (!button.disabled && !button.isLoading) return button.onClick?.()
    },
    reset: () => {
      buttons.length = 0
      for (const spy of Object.values(toast)) spy.mockClear()
    },
  }
}
