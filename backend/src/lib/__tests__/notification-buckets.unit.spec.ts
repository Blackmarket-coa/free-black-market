import {
  BUCKET_LABELS,
  classifyNotification,
  countByBucket,
  NOTIFICATION_BUCKETS,
  type NotificationBucket,
} from "../notification-buckets"

describe("notification-buckets: taxonomy", () => {
  it("exposes the three buckets in canonical order", () => {
    expect(NOTIFICATION_BUCKETS).toEqual(["awaits_me", "about_me", "fyi"])
  })

  it("has a human-readable label for each bucket", () => {
    for (const b of NOTIFICATION_BUCKETS) {
      expect(BUCKET_LABELS[b]).toBeTruthy()
    }
  })
})

describe("notification-buckets: classifyNotification", () => {
  it("classifies new orders as awaits_me (the marquee case)", () => {
    expect(classifyNotification("seller_new_order_notification")).toBe("awaits_me")
  })

  it("classifies action-required and review-needed templates as awaits_me", () => {
    expect(
      classifyNotification("seller_verification_action_required_notification")
    ).toBe("awaits_me")
    expect(
      classifyNotification("seller_escrow_milestone_review_needed")
    ).toBe("awaits_me")
    expect(
      classifyNotification("seller_order_dispute_opened_notification")
    ).toBe("awaits_me")
  })

  it("matches awaits_me pattern fallbacks for novel template names", () => {
    expect(classifyNotification("fbm_payment_approval_required_v2")).toBe(
      "awaits_me"
    )
    expect(classifyNotification("custom_pending_response_alert")).toBe("awaits_me")
    expect(classifyNotification("vendor_fulfillment_overdue_24h")).toBe("awaits_me")
  })

  it("classifies acceptances / rejections / payouts as about_me", () => {
    expect(
      classifyNotification(
        "seller_product_collection_request_accepted_notification"
      )
    ).toBe("about_me")
    expect(
      classifyNotification("seller_product_request_rejected_notification")
    ).toBe("about_me")
    expect(classifyNotification("seller_payout_completed_notification")).toBe(
      "about_me"
    )
  })

  it("classifies explicit broadcasts as fyi", () => {
    expect(classifyNotification("platform_announcement")).toBe("fyi")
    expect(classifyNotification("policy_change_notice")).toBe("fyi")
    expect(classifyNotification("scheduled_maintenance")).toBe("fyi")
  })

  it("matches fyi pattern fallbacks for novel broadcast names", () => {
    expect(classifyNotification("broadcast_v3_release_notes")).toBe("fyi")
    expect(classifyNotification("announcement_2026_q2_roadmap")).toBe("fyi")
  })

  it("falls back to about_me for unknown templates (safe default)", () => {
    expect(classifyNotification("some_template_we_have_never_seen")).toBe(
      "about_me"
    )
    expect(classifyNotification("seller_random_event_notification")).toBe(
      "about_me"
    )
  })

  it("handles missing or non-string templates", () => {
    expect(classifyNotification(null)).toBe("about_me")
    expect(classifyNotification(undefined)).toBe("about_me")
    expect(classifyNotification("")).toBe("about_me")
    expect(classifyNotification(42 as unknown as string)).toBe("about_me")
  })

  it("awaits_me beats fyi when a template matches both", () => {
    // Defence-in-depth: action-required overrides a coincidental
    // "announcement_" prefix.
    expect(
      classifyNotification("announcement_action_required_fyi")
    ).toBe("awaits_me")
  })
})

describe("notification-buckets: countByBucket", () => {
  it("returns zeros for an empty list", () => {
    expect(countByBucket([])).toEqual({ awaits_me: 0, about_me: 0, fyi: 0 })
  })

  it("bins notifications correctly across buckets", () => {
    const counts = countByBucket([
      { template: "seller_new_order_notification" },
      { template: "seller_new_order_notification" },
      { template: "seller_product_request_accepted_notification" },
      { template: "platform_announcement" },
      { template: undefined },
      { template: "broadcast_v2" },
    ])
    expect(counts).toEqual<Record<NotificationBucket, number>>({
      awaits_me: 2,
      about_me: 2,
      fyi: 2,
    })
  })

  it("is robust to missing/null template fields", () => {
    const counts = countByBucket([
      {},
      { template: null },
      { template: "" },
      { template: "seller_new_order_notification" },
    ])
    expect(counts).toEqual({ awaits_me: 1, about_me: 3, fyi: 0 })
  })
})
