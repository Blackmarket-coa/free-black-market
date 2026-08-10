"use client"

import { useState } from "react"

type FeeParts = {
  commission: number
  processing: number
  ads: number
  fulfillment: number
  listing: number
  other: number
  total: number
}

type Platform = {
  name: string
  color: string
  icon: string
  calcFees: (price: number) => FeeParts
  breakdown: string[]
  verdict: string
}

/**
 * Competitor fee models. These are published rate cards, not live API reads —
 * they are as accurate as the last time someone checked them, which is why the
 * page that renders this component dates them.
 *
 * Our own row is the exception and is built separately by `buildPlatforms()`
 * from the rate the backend actually charges, so the one number we are
 * accountable for cannot drift from the billing catalog.
 */
const competitorPlatforms: Platform[] = [
  {
    name: "Shopify",
    color: "#96BF48",
    icon: "🛒",
    calcFees: (price) => {
      const processing = price * 0.029 + 0.3
      const monthlyAmortized = (39 * 12) / 365
      return { commission: 0, processing, ads: 0, fulfillment: 0, listing: 0, other: monthlyAmortized, total: processing + monthlyAmortized }
    },
    breakdown: [
      "$39/month Basic plan ($468/yr)",
      "2.9% + $0.30 per transaction",
      "2% extra if not using Shopify Payments",
      "Apps: $50–$300/month typical",
      "Theme: $150–$400 one-time",
      "YOU drive all traffic",
    ],
    verdict: "YOU PAY FOR EVERYTHING",
  },
  {
    name: "Etsy",
    color: "#F56400",
    icon: "🧶",
    calcFees: (price) => {
      const listing = 0.2
      const transaction = price * 0.065
      const processing = price * 0.03 + 0.25
      const offsiteAds = price * 0.15
      return { commission: transaction, processing, ads: offsiteAds, fulfillment: 0, listing, other: 0, total: listing + transaction + processing + offsiteAds }
    },
    breakdown: [
      "$0.20 listing fee per item",
      "6.5% transaction fee on price + shipping",
      "3% + $0.25 payment processing",
      "12–15% Offsite Ads (mandatory if >$10K)",
      "$15–$29 shop setup fee",
      "Fees on SHIPPING too",
    ],
    verdict: "DEATH BY 1,000 CUTS",
  },
  {
    name: "Amazon FBA",
    color: "#FF9900",
    icon: "📦",
    calcFees: (price) => {
      const referral = price * 0.15
      const fba = 3.5 + (price > 50 ? 0.51 : 0.25)
      const monthly = (39.99 * 12) / 365
      return { commission: referral, processing: 0, ads: 0, fulfillment: fba, listing: 0, other: monthly, total: referral + fba + monthly }
    },
    breakdown: [
      "8–15% referral fee (most categories 15%)",
      "$3.50+ FBA fulfillment per unit",
      "$39.99/month Professional plan",
      "Monthly storage fees ($0.87–$2.40/cu ft)",
      "Long-term storage surcharges",
      "They OWN your customer",
    ],
    verdict: "THE EXTRACTION MACHINE",
  },
  {
    name: "Uber Eats",
    color: "#06C167",
    icon: "🍔",
    calcFees: (price) => {
      const commission = price * 0.25
      return { commission, processing: 0, ads: 0, fulfillment: 0, listing: 0, other: 0, total: commission }
    },
    breakdown: [
      "20–30% commission per delivery order",
      "7% pickup order fee (raised March 2026)",
      "Payment processing included",
      "Sponsored listings extra cost",
      "They own the customer relationship",
      "Restaurant brand becomes invisible",
    ],
    verdict: "30% OF YOUR FOOD",
  },
  {
    name: "DoorDash",
    color: "#FF3008",
    icon: "🚗",
    calcFees: (price) => {
      const commission = price * 0.28
      return { commission, processing: 0, ads: 0, fulfillment: 0, listing: 0, other: 0, total: commission }
    },
    breakdown: [
      "15–30% commission (Basic/Plus/Premier)",
      "6% pickup fee",
      "Sponsored Listings: extra cost",
      "DashPass access requires higher tier (25–30%)",
      "43% of customers forget restaurant name",
      "Actual cost can exceed 40% with promos",
    ],
    verdict: "PAY TO BE FORGOTTEN",
  },
  {
    name: "Faire",
    color: "#1B1B1B",
    icon: "🏪",
    calcFees: (price) => {
      const commission = price * 0.15
      const newCustomerFee = 10
      const processing = price * 0.025 + 0.3
      return { commission, processing, ads: 0, fulfillment: 0, listing: 0, other: newCustomerFee / 10, total: commission + processing + newCustomerFee / 10 }
    },
    breakdown: [
      "15% commission on marketplace orders",
      "$10 new customer fee (first order)",
      "1.9–3.5% + $0.30 payment processing",
      "Effective rate: 17–19% per order",
      "Can’t inflate prices to cover fees",
      "They own the retailer relationship",
    ],
    verdict: "WHOLESALE TOLL BOOTH",
  },
]

/**
 * Build the platform list with our own row driven by `feePercent` — the rate
 * served by `/store/fee-schedule`, which reads the same catalog that charges
 * vendors. Callers that cannot reach the backend pass the documented fallback.
 */
export function buildPlatforms(feePercent: number): Platform[] {
  const rate = feePercent / 100
  return [
    {
      name: "BMC",
      color: "#2D8B4E",
      icon: "🌿",
      calcFees: (price) => {
        const commission = price * rate
        return { commission, processing: 0, ads: 0, fulfillment: 0, listing: 0, other: 0, total: commission }
      },
      breakdown: [
        `${feePercent}% marketplace commission`,
        "No payment processing fees passed to you",
        "No listing fees",
        "No mandatory ads",
        "No monthly subscription",
        "Internal ledger settlement (Coalition Credits) — internal processor coming soon",
      ],
      verdict: "COOPERATIVE",
    },
    ...competitorPlatforms,
  ]
}

/**
 * Invert a fee model: what must a vendor list an item at to take home `target`?
 *
 * Solved by bisection rather than algebraically because the models are not all
 * linear — Amazon's FBA fee steps at $50, Faire adds a flat new-customer fee —
 * and a closed form per platform would be six chances to get the arithmetic
 * wrong. 60 iterations over a $0–$100k bracket converges far below a cent.
 *
 * Returns null when no price in the bracket clears the target, which happens
 * for a platform whose fees grow at least as fast as the price.
 */
export function priceForTargetTakeHome(
  platform: Platform,
  target: number
): number | null {
  let low = 0
  let high = 100_000

  const takeHome = (price: number) => price - platform.calcFees(price).total

  if (takeHome(high) < target) return null

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    if (takeHome(mid) < target) {
      low = mid
    } else {
      high = mid
    }
  }
  return high
}

type FeeBreakdownProps = {
  /**
   * Platform commission as a percentage. Defaults to 3 so existing call sites
   * keep working, but pages should pass the value from `getFeeSchedule()`.
   */
  feePercent?: number
}

export default function FeeBreakdown({ feePercent = 3 }: FeeBreakdownProps) {
  const [mode, setMode] = useState<"forward" | "target">("forward")
  const [salePrice, setSalePrice] = useState(50)
  const [targetTakeHome, setTargetTakeHome] = useState(50)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)

  const platforms = buildPlatforms(feePercent)

  const results = platforms
    .map((platform) => {
      // In target mode each platform is priced at whatever it takes to clear
      // the same take-home, so the comparison is "what must I charge?" rather
      // than "what am I left with?".
      const price =
        mode === "target"
          ? priceForTargetTakeHome(platform, targetTakeHome)
          : salePrice

      if (price === null) {
        return { ...platform, fees: null, price: null, youKeep: null, effectiveRate: null }
      }

      const fees = platform.calcFees(price)
      return {
        ...platform,
        fees,
        price,
        youKeep: price - fees.total,
        effectiveRate: price > 0 ? (fees.total / price) * 100 : 0,
      }
    })
    .sort((a, b) => (a.fees?.total ?? Infinity) - (b.fees?.total ?? Infinity))

  const bmcResult = results.find((result) => result.name === "BMC")
  const maxFees = Math.max(...results.map((result) => result.fees?.total ?? 0))

  if (!bmcResult || !bmcResult.fees) {
    return null
  }

  return (
    <section style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", background: "#0A0A0A", color: "#fff", padding: "48px 16px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 13, letterSpacing: 3, color: "#2D8B4E", fontWeight: 700, marginBottom: 8 }}>BLACKMARKET COALITION</div>
          <h2 style={{ fontSize: 32, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.1 }}>Where Does Your Money Go?</h2>
          <p style={{ color: "#888", fontSize: 15, margin: 0 }}>Fee breakdown on a single sale across 7 platforms</p>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "center" }}>
          {(
            [
              { key: "forward", label: "I charge this…" },
              { key: "target", label: "I want to keep this…" },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMode(option.key)}
              style={{
                background: mode === option.key ? "#2D8B4E" : "#151515",
                color: mode === option.key ? "#fff" : "#888",
                border: `1px solid ${mode === option.key ? "#2D8B4E" : "#222"}`,
                borderRadius: 999,
                padding: "8px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div style={{ background: "#151515", borderRadius: 16, padding: "20px 24px", marginBottom: 24, border: "1px solid #222" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: "#888", fontSize: 13, fontWeight: 600 }}>
              {mode === "forward" ? "SALE PRICE" : "TAKE-HOME PER SALE"}
            </span>
            <span style={{ fontSize: 36, fontWeight: 800, color: "#fff" }}>
              ${mode === "forward" ? salePrice : targetTakeHome}
            </span>
          </div>
          {mode === "forward" ? (
            <input
              type="range"
              min={10}
              max={200}
              value={salePrice}
              aria-label="Sale price"
              onChange={(e) => setSalePrice(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#2D8B4E", height: 6, cursor: "pointer" }}
            />
          ) : (
            <input
              type="range"
              min={10}
              max={200}
              value={targetTakeHome}
              aria-label="Target take-home per sale"
              onChange={(e) => setTargetTakeHome(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#2D8B4E", height: 6, cursor: "pointer" }}
            />
          )}
          <p style={{ color: "#666", fontSize: 12, margin: "10px 0 0" }}>
            {mode === "forward"
              ? "What each platform takes out of that price, and what reaches you."
              : "What you would have to list the item at on each platform to end up with that much."}
          </p>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {results.map((result) => {
            const isBmc = result.name === "BMC"
            const isSelected = selectedPlatform === result.name

            if (!result.fees || result.price === null) {
              return (
                <div
                  key={result.name}
                  style={{ background: "#151515", borderRadius: 14, padding: "16px 20px", border: "1px solid #222" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{result.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>{result.name}</div>
                      <div style={{ fontSize: 12, color: "#FF4444" }}>
                        No listed price reaches this take-home on this platform.
                      </div>
                    </div>
                  </div>
                </div>
              )
            }

            const savings = isBmc ? 0 : result.fees.total - bmcResult.fees!.total
            const barWidth = maxFees > 0 ? (result.fees.total / maxFees) * 100 : 0

            return (
              <div
                key={result.name}
                onClick={() => setSelectedPlatform(isSelected ? null : result.name)}
                style={{
                  background: isBmc ? "linear-gradient(135deg, #0D2818, #1A3A2A)" : "#151515",
                  borderRadius: 14,
                  padding: "16px 20px",
                  border: isBmc ? "2px solid #2D8B4E" : isSelected ? `2px solid ${result.color}44` : "1px solid #222",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{result.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: isBmc ? "#2D8B4E" : "#fff" }}>{result.name}</div>
                      <div style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>{result.verdict}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: isBmc ? "#2D8B4E" : "#fff" }}>${result.fees.total.toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{result.effectiveRate.toFixed(1)}% effective rate</div>
                  </div>
                </div>

                <div style={{ height: 6, background: "#222", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                  <div style={{ height: "100%", width: `${barWidth}%`, background: isBmc ? "#2D8B4E" : result.color, borderRadius: 3, transition: "width 0.5s ease" }} />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#888" }}>
                    {mode === "forward" ? "You keep: " : "List it at: "}
                    <span style={{ color: isBmc ? "#2D8B4E" : "#fff", fontWeight: 700 }}>
                      ${(mode === "forward" ? result.youKeep! : result.price).toFixed(2)}
                    </span>
                  </span>
                  {!isBmc && savings > 0 && <span style={{ color: "#FF4444", fontWeight: 600 }}>−${savings.toFixed(2)} vs BMC</span>}
                </div>

                {isSelected && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #333" }}>
                    {result.breakdown.map((item) => (
                      <div key={item} style={{ fontSize: 12, color: "#aaa", padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: isBmc ? "#2D8B4E" : result.color }}>•</span>
                        {item}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
