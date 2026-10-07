import dailyPayoutsJob, { config } from "../daily-payouts"
import mercurDailyPayouts, { config as mercurConfig } from "@mercurjs/b2c-core/jobs/daily-payouts"
import { ledgerRailHasSent, runLedgerConnectPayouts } from "../../lib/ledger-connect-payouts"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"

/**
 * The job that replaces Mercur's `daily-payouts` (SD-41). That it IS the job
 * the workflow engine runs is proved on a real app in
 * integration-tests/http/ledger-connect-payouts.spec.ts; here, which way it
 * goes:
 *
 *   - same name and schedule as Mercur's, so it replaces it;
 *   - flag off: Mercur's handler, unchanged;
 *   - flag off after the ledger rail has sent anything: neither (Mercur's
 *     would pay those orders again);
 *   - flag on: the ledger run, and never Mercur's handler.
 */

jest.mock("@mercurjs/b2c-core/jobs/daily-payouts", () => ({
  __esModule: true,
  default: jest.fn(async () => undefined),
  config: jest.requireActual("@mercurjs/b2c-core/jobs/daily-payouts").config,
}))
jest.mock("../../lib/ledger-connect-payouts", () => ({
  ...jest.requireActual("../../lib/ledger-connect-payouts"),
  ledgerRailHasSent: jest.fn(async () => false),
  runLedgerConnectPayouts: jest.fn(async () => ({
    skipped: false,
    sellers: 0,
    refused_accounts: [],
    held: [],
    booked_mercur_paid: 0,
    cutover_blocked: [],
    requested: [],
    sent: [],
    failed: [],
    waiting: [],
    stuck_in_transit: [],
  })),
}))

const FLAG = PHASE0_FEATURE_FLAGS.LEDGER_CONNECT_PAYOUTS_V1
const mercur = mercurDailyPayouts as jest.MockedFunction<typeof mercurDailyPayouts>
const hasSent = ledgerRailHasSent as jest.MockedFunction<typeof ledgerRailHasSent>
const run = runLedgerConnectPayouts as jest.MockedFunction<typeof runLedgerConnectPayouts>

const container = {
  resolve: (key: string) => {
    if (key !== HAWALA_LEDGER_MODULE) throw new Error(`resolved ${key}`)
    return {}
  },
} as never

afterEach(() => {
  delete process.env[FLAG]
  jest.clearAllMocks()
})

it("has Mercur's job name and schedule, so it replaces it", () => {
  expect(config).toEqual({ name: mercurConfig.name, schedule: mercurConfig.schedule })
})

it("flag off: hands to Mercur's handler, unchanged", async () => {
  await dailyPayoutsJob(container)
  expect(mercur).toHaveBeenCalledWith(container)
  expect(run).not.toHaveBeenCalled()
})

it("flag off after the ledger has sent payouts: neither runs", async () => {
  hasSent.mockResolvedValueOnce(true)
  await dailyPayoutsJob(container)
  expect(mercur).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
})

it("flag on: the ledger run, never Mercur's", async () => {
  process.env[FLAG] = "true"
  await dailyPayoutsJob(container)
  expect(run).toHaveBeenCalledWith(container)
  expect(mercur).not.toHaveBeenCalled()
})

it("never throws, so the schedule keeps running", async () => {
  process.env[FLAG] = "true"
  run.mockRejectedValueOnce(new Error("boom"))
  await expect(dailyPayoutsJob(container)).resolves.toBeUndefined()
})
