import { describe, expect, it } from "vitest"

import type {
  VendorPlanChangePreview,
  VendorPlanChangeResponse,
} from "../../../hooks/api/vendor-plan"
import {
  changeOutcome,
  describeChangeTerms,
  newPanelIdempotencyKey,
} from "./plan-terms"

/**
 * The confirm step is the vendor's approval of a recurring charge, so its
 * terms come from the per-seller `GET /vendor/plan/preview`, never from the
 * catalog's static `trial_days`. These are the backend's preview bodies for
 * the cases the catalog row gets wrong.
 */

const preview = (
  over: Partial<VendorPlanChangePreview> = {}
): VendorPlanChangePreview => ({
  plan_code: "all_access",
  display_name: "All-Access",
  price_amount: 1000,
  currency_code: "usd",
  interval: "month",
  change: "upgrade",
  deferred: false,
  effective_at: null,
  trial_days: 30,
  trial_ends_at: "2026-11-04T12:00:00.000Z",
  charge_now_amount: 0,
  first_charge_at: "2026-11-04T12:00:00.000Z",
  renews: true,
  requires_auto_renew_consent: true,
  ...over,
})

describe("describeChangeTerms", () => {
  it("first-time all_access: the trial, then $10, and the date of the first charge", () => {
    expect(describeChangeTerms(preview())).toBe(
      "30-day free trial, then $10.00/month. First charge on Nov 4, 2026. Renews every month until you cancel; cancelling keeps the plan to the end of the period already paid for."
    )
  })

  it("returning all_access vendor: no trial promised, $10 charged today", () => {
    // The catalog still says trial_days: 30; this seller gets none.
    const terms = describeChangeTerms(
      preview({
        trial_days: 0,
        trial_ends_at: null,
        charge_now_amount: 1000,
        first_charge_at: "2026-10-05T12:00:00.000Z",
      })
    )
    expect(terms).toBe(
      "No free trial. $10.00 is charged today, then $10.00/month. Renews every month until you cancel; cancelling keeps the plan to the end of the period already paid for."
    )
    expect(terms).not.toContain("trial,")
  })

  it("deferred move onto all_access: says when it lands, and the trial from that date", () => {
    expect(
      describeChangeTerms(
        preview({
          change: "downgrade",
          deferred: true,
          effective_at: "2026-11-01T00:00:00.000Z",
          trial_ends_at: "2026-12-01T00:00:00.000Z",
          first_charge_at: "2026-12-01T00:00:00.000Z",
        })
      )
    ).toBe(
      "Takes effect on Nov 1, 2026. You keep your current plan until then. 30-day free trial from that date, then $10.00/month. First charge on Dec 1, 2026. Renews every month until you cancel; cancelling keeps the plan to the end of the period already paid for."
    )
  })

  it("deferred move with no trial: first charged the day it lands, never 'billed from today'", () => {
    const terms = describeChangeTerms(
      preview({
        change: "downgrade",
        deferred: true,
        effective_at: "2026-11-01T00:00:00.000Z",
        trial_days: 0,
        trial_ends_at: null,
        first_charge_at: "2026-11-01T00:00:00.000Z",
      })
    )
    expect(terms).toBe(
      "Takes effect on Nov 1, 2026. You keep your current plan until then. No free trial. $10.00/month, first charged on Nov 1, 2026. Renews every month until you cancel; cancelling keeps the plan to the end of the period already paid for."
    )
    expect(terms).not.toContain("today")
  })

  it("moving to free: no charge, and when it lands", () => {
    const free = {
      plan_code: "free",
      display_name: "Free",
      price_amount: 0,
      interval: "none" as const,
      trial_days: 0,
      trial_ends_at: null,
      first_charge_at: null,
      renews: false,
      requires_auto_renew_consent: false,
    }
    expect(describeChangeTerms(preview(free))).toBe(
      "No monthly charge. Takes effect now."
    )
    expect(
      describeChangeTerms(
        preview({ ...free, deferred: true, effective_at: "2026-11-04T12:00:00.000Z" })
      )
    ).toBe(
      "Takes effect on Nov 4, 2026. You keep your current plan until then. No monthly charge after that."
    )
  })
})

const response = (
  over: Partial<VendorPlanChangeResponse> = {}
): VendorPlanChangeResponse => ({
  charge_status: null,
  plan: {
    code: "all_access",
    status: "trialing",
    current_period_end: "2026-11-04T12:00:00.000Z",
    pending_plan_code: null,
    pending_effective_at: null,
  },
  applied: true,
  deferred: false,
  replayed: false,
  ...over,
})

describe("changeOutcome", () => {
  it("never reports a replay as a move", () => {
    // The reviewer's case: the backend replayed the key, the vendor is still
    // on free. "Moved to All-Access" would be false.
    const outcome = changeOutcome(
      "All-Access",
      response({
        applied: false,
        replayed: true,
        plan: {
          code: "free",
          status: "active",
          current_period_end: null,
          pending_plan_code: null,
          pending_effective_at: null,
        },
      })
    )
    expect(outcome.kind).toBe("unchanged")
    expect(outcome.message).not.toContain("Moved")
  })

  it("treats neither-applied-nor-deferred as no change", () => {
    expect(
      changeOutcome("All-Access", response({ applied: false, deferred: false })).kind
    ).toBe("unchanged")
  })

  it("reports a trial, a move and a scheduled change as what they are", () => {
    expect(changeOutcome("All-Access", response())).toEqual({
      kind: "trial",
      message: "All-Access trial started",
    })
    expect(
      changeOutcome(
        "All-Access",
        response({ plan: { ...response().plan, status: "active" } })
      )
    ).toEqual({ kind: "moved", message: "Moved to All-Access" })
    expect(
      changeOutcome(
        "Free",
        response({
          applied: false,
          deferred: true,
          plan: {
            ...response().plan,
            pending_plan_code: "free",
            pending_effective_at: "2026-11-04T12:00:00.000Z",
          },
        })
      )
    ).toEqual({
      kind: "deferred",
      message: "Free takes effect on Nov 4, 2026. You keep your current plan until then.",
    })
  })
})

describe("newPanelIdempotencyKey", () => {
  it("is unique per confirm attempt and carries no plan or date", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newPanelIdempotencyKey()))
    expect(keys.size).toBe(50)
    for (const key of keys) {
      expect(key.startsWith("panel:")).toBe(true)
      expect(key).not.toMatch(/all_access|free|\d{4}-\d{2}-\d{2}/)
    }
  })
})
