import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import type { ReactElement, ReactNode } from "react"

/**
 * NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1 (twin of the API's FF_CUSTOMER_WALLET_V1):
 * with it off the storefront renders no wallet surface and calls no wallet
 * route — /wallet and /user/coalition-credits are not found, their nav entry
 * and the /invest "Open Wallet" CTA are absent, the dashboard renders nothing
 * and mounts none of its hooks, and the coalition-credits data reads return
 * null without a request. Each flag-on case proves the same code is reached.
 */
const h = vi.hoisted(() => ({
  flags: { customerWallet: false, investmentPools: true, consumerSubscriptions: false },
  hooks: {
    useWallet: vi.fn(),
    useTransactions: vi.fn(),
    useBankAccounts: vi.fn(),
    useDeposit: vi.fn(),
    useWithdraw: vi.fn(),
    useInvestments: vi.fn(),
  },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  medusaFetch: vi.fn(),
  getAuthHeaders: vi.fn(),
  retrieveCustomerContext: vi.fn(),
}))

vi.mock("@/lib/feature-flags", () => ({ phase1ModuleFlags: h.flags }))
vi.mock("@/lib/hooks/useHawalaWallet", () => h.hooks)
vi.mock("next/navigation", () => ({ notFound: h.notFound, usePathname: () => "/user/orders" }))
vi.mock("@/lib/config", () => ({ medusaFetch: h.medusaFetch }))
vi.mock("../config", () => ({ medusaFetch: h.medusaFetch }))
vi.mock("@/lib/data/cookies", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("../data/cookies", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("@/lib/data/customer", () => ({ retrieveCustomerContext: h.retrieveCustomerContext }))
vi.mock("@/components/molecules", () => ({
  AccountLoadingState: () => null,
  LoginForm: () => null,
  UserNavigation: () => null,
}))
vi.mock("@/components/sections/InvestmentPools", () => ({ InvestmentPoolsSection: () => null }))
vi.mock("@/components/atoms", () => ({
  Badge: () => null,
  Card: () => null,
  Divider: () => null,
  LogoutButton: () => null,
  NavigationItem: () => null,
}))
vi.mock("@/components/molecules/BugReportButton/BugReportButton", () => ({ BugReportButton: () => null }))
vi.mock("@/providers/MatrixChatProvider", () => ({ useMatrixChat: () => ({ unreadCount: 0 }) }))

import { WalletDashboard } from "@/components/sections/WalletDashboard/WalletDashboard"
import WalletPage from "@/app/[locale]/(main)/wallet/page"
import CoalitionCreditsPage from "@/app/[locale]/(main)/user/coalition-credits/page"
import InvestPage from "@/app/[locale]/(main)/invest/page"
import { getCoalitionCreditsWallet, listCoalitionCreditsTransactions } from "@/lib/data/coalition-credits"

// This suite's esbuild emits classic `React.createElement` for the TSX under
// test (the app's tsconfig is `jsx: preserve`, which Next compiles itself).
;(globalThis as { React?: typeof React }).React = React

/** Every element in a rendered tree, without rendering function components. */
function elements(node: ReactNode): ReactElement[] {
  if (!node || typeof node !== "object") return []
  if (Array.isArray(node)) return node.flatMap(elements)
  const el = node as ReactElement<{ children?: ReactNode }>
  return [el, ...elements(el.props?.children)]
}
const hrefs = (node: ReactNode) =>
  elements(node)
    .map((e) => (e.props as { href?: string }).href)
    .filter(Boolean)

const ENV = "NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1"

beforeEach(() => {
  vi.clearAllMocks()
  h.flags.customerWallet = false
  h.getAuthHeaders.mockResolvedValue({ Authorization: "Bearer jwt_customer" })
  h.medusaFetch.mockResolvedValue({ wallet: { id: "acc_1" }, balance: {}, transactions: [] })
  h.retrieveCustomerContext.mockResolvedValue({ customer: null, isAuthenticated: false })
})

afterEach(() => {
  delete process.env[ENV]
})

describe("the flag reader", () => {
  it("defaults off and only the literal string true turns customerWallet on", async () => {
    const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags")
    expect(actual.phase1ModuleFlags.customerWallet).toBe(false)
    for (const [value, want] of [["1", false], ["TRUE", false], ["true", true]] as const) {
      process.env[ENV] = value
      vi.resetModules()
      const fresh = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags")
      expect({ value, on: fresh.phase1ModuleFlags.customerWallet }).toEqual({ value, on: want })
    }
  })
})

describe("with NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1 off", () => {
  it("WalletDashboard renders nothing and mounts none of the wallet hooks", () => {
    expect(WalletDashboard()).toBeNull()
    for (const hook of Object.values(h.hooks)) expect(hook).not.toHaveBeenCalled()
  })

  it("/wallet is not found", () => {
    expect(() => WalletPage()).toThrow("NEXT_NOT_FOUND")
    expect(h.notFound).toHaveBeenCalledTimes(1)
  })

  it("/user/coalition-credits is not found before the customer is read or a wallet route is called", async () => {
    await expect(CoalitionCreditsPage()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(h.retrieveCustomerContext).not.toHaveBeenCalled()
    expect(h.getAuthHeaders).not.toHaveBeenCalled()
    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("the coalition-credits reads answer null without a request", async () => {
    expect(await getCoalitionCreditsWallet()).toBeNull()
    expect(await listCoalitionCreditsTransactions({ limit: 5 })).toBeNull()
    expect(h.getAuthHeaders).not.toHaveBeenCalled()
    expect(h.medusaFetch).not.toHaveBeenCalled()
  })

  it("/invest (its own flag on) carries no link to /wallet", () => {
    expect(hrefs(InvestPage())).not.toContain("/wallet")
  })

  it("the account nav has no Coalition Credits entry", async () => {
    vi.resetModules()
    const { navigationItems } = await import("@/components/molecules/UserNavigation/UserNavigation")
    expect(navigationItems.map((i) => i.href)).not.toContain("/user/coalition-credits")
    expect(navigationItems.map((i) => i.href)).toContain("/user/orders")
  })
})

describe("with NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1 on: today's behaviour", () => {
  beforeEach(() => {
    h.flags.customerWallet = true
  })

  it("WalletDashboard renders the dashboard", () => {
    const el = WalletDashboard() as ReactElement
    expect(el).not.toBeNull()
    expect((el.type as { name?: string }).name).toBe("WalletDashboardContent")
  })

  it("/wallet renders the dashboard", () => {
    expect(elements(WalletPage()).some((e) => e.type === WalletDashboard)).toBe(true)
    expect(h.notFound).not.toHaveBeenCalled()
  })

  it("/user/coalition-credits reads the customer (and, signed in, the wallet routes)", async () => {
    await CoalitionCreditsPage()
    expect(h.retrieveCustomerContext).toHaveBeenCalledTimes(1)
    h.retrieveCustomerContext.mockResolvedValue({ customer: { id: "cus_1" }, isAuthenticated: true })
    await CoalitionCreditsPage()
    expect(h.medusaFetch.mock.calls.map(([p]) => p)).toEqual(["/store/hawala/wallet", "/store/hawala/transactions?limit=25"])
  })

  it("/invest links to /wallet", () => {
    expect(hrefs(InvestPage())).toContain("/wallet")
  })

  it("the account nav lists Coalition Credits", async () => {
    vi.resetModules()
    const { navigationItems } = await import("@/components/molecules/UserNavigation/UserNavigation")
    expect(navigationItems.map((i) => i.href)).toContain("/user/coalition-credits")
  })
})
