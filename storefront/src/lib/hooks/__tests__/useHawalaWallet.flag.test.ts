import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The customer-wallet hooks with NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1 off: they
 * fetch nothing on mount and their actions reject `feature_disabled` without
 * calling the `hawalaRequest` server action at all.
 *
 * There is no DOM renderer in this suite, so React's hooks are replaced with
 * the smallest faithful stand-ins: useState answers its initial value,
 * useCallback answers the callback, and useEffect RUNS its effect. The flag-on
 * cases prove that harness does reach the fetch, so the flag-off silence is not
 * a harness that never fetches.
 */
const { hawalaRequest, flags, setStateCalls } = vi.hoisted(() => ({
  hawalaRequest: vi.fn(),
  flags: { customerWallet: false },
  setStateCalls: [] as unknown[],
}))
vi.mock("@/lib/data/hawala", () => ({ hawalaRequest }))
vi.mock("@/lib/feature-flags", () => ({ phase1ModuleFlags: flags }))
vi.mock("react", () => ({
  useState: <T,>(init: T | (() => T)) => [
    typeof init === "function" ? (init as () => T)() : init,
    (next: unknown) => setStateCalls.push(next),
  ],
  useCallback: <F,>(fn: F) => fn,
  useEffect: (fn: () => void) => fn(),
}))

import {
  contributeToCarriedPool,
  HawalaRequestError,
  useBankAccounts,
  useDeposit,
  useInvestmentPools,
  useTransactions,
  useWallet,
  useWithdraw,
} from "@/lib/hooks/useHawalaWallet"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const paths = () => hawalaRequest.mock.calls.map(([req]) => (req as { path: string }).path)

beforeEach(() => {
  vi.clearAllMocks()
  setStateCalls.length = 0
  flags.customerWallet = false
  hawalaRequest.mockResolvedValue({ ok: true, data: { wallet: null, balance: null, transactions: [], bank_accounts: [], pools: [] } })
})

describe("wallet hooks with the flag off", () => {
  it("mount without fetching or touching state: not loading, no error", async () => {
    const mounted = [useWallet(), useTransactions(), useBankAccounts()]
    await flush()
    for (const m of mounted) expect({ loading: m.loading, error: m.error }).toEqual({ loading: false, error: null })
    // No effect ran a fetch: not even one that the transport refused and that
    // would leave an error state behind.
    expect(setStateCalls).toEqual([])
    expect(hawalaRequest).not.toHaveBeenCalled()
  })

  it("every wallet action rejects feature_disabled without calling the server action", async () => {
    const actions: (() => Promise<unknown>)[] = [
      () => useWallet().createWallet(),
      () => useBankAccounts().startLinking("a@b.test", "https://x.test/return"),
      () => useBankAccounts().completeLinking("cus_1", "fca_1"),
      () => useDeposit().deposit("ba_1", 10),
      () => useWithdraw().withdraw("ba_1", 10),
    ]
    for (const run of actions) {
      const err = await run().then(
        () => "resolved",
        (e: unknown) => e
      )
      expect(err).toBeInstanceOf(HawalaRequestError)
      expect(err).toMatchObject({ type: "feature_disabled", status: 404 })
    }
    // A manual refetch keeps its error state rather than throwing; it still
    // calls nothing.
    await useWallet().refetch()
    await useTransactions().refetch()
    await useBankAccounts().refetch()
    expect(hawalaRequest).not.toHaveBeenCalled()
  })

  it("leaves the pools listing and the carried-pool contribution alone (their own flags)", async () => {
    useInvestmentPools()
    await contributeToCarriedPool("pool_1", 2500)
    await flush()
    expect(paths()).toEqual(["/store/hawala/pools", "/store/hawala/pools/pool_1/contributions"])
  })
})

describe("wallet hooks with the flag on: today's behaviour", () => {
  beforeEach(() => {
    flags.customerWallet = true
  })

  it("each hook fetches its route on mount", async () => {
    expect(useWallet().loading).toBe(true)
    useTransactions()
    useBankAccounts()
    await flush()
    expect(paths()).toEqual(["/store/hawala/wallet", "/store/hawala/transactions", "/store/hawala/bank-accounts"])
  })

  it("the money actions go through the server action", async () => {
    await useDeposit().deposit("ba_1", 10)
    await useWithdraw().withdraw("ba_1", 10)
    expect(paths()).toEqual(["/store/hawala/deposit", "/store/hawala/withdraw"])
  })
})
