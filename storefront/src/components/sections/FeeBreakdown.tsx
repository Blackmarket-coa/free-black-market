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

const platforms: Platform[] = [
  {
    name: "BMC",
    color: "#2D8B4E",
    icon: "🌿",
    calcFees: (price) => {
      const commission = price * 0.03
      const processing = price * 0.029 + 0.3
      return { commission, processing, ads: 0, fulfillment: 0, listing: 0, other: 0, total: commission + processing }
    },
    breakdown: [
      "3% marketplace commission",
      "2.9% + $0.30 Stripe processing",
      "No listing fees",
      "No mandatory ads",
      "No monthly subscription",
      "Community-owned cooperative",
    ],
    verdict: "COOPERATIVE",
  },
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

export default function FeeBreakdown() {
  const [salePrice, setSalePrice] = useState(50)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)

  const results = platforms
    .map((platform) => {
      const fees = platform.calcFees(salePrice)
      const youKeep = salePrice - fees.total
      const effectiveRate = (fees.total / salePrice) * 100
      return { ...platform, fees, youKeep, effectiveRate }
    })
    .sort((a, b) => a.fees.total - b.fees.total)

  const bmcResult = results.find((result) => result.name === "BMC")
  const maxFees = Math.max(...results.map((result) => result.fees.total))

  if (!bmcResult) {
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

        <div style={{ background: "#151515", borderRadius: 16, padding: "20px 24px", marginBottom: 24, border: "1px solid #222" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: "#888", fontSize: 13, fontWeight: 600 }}>SALE PRICE</span>
            <span style={{ fontSize: 36, fontWeight: 800, color: "#fff" }}>${salePrice}</span>
          </div>
          <input type="range" min={10} max={200} value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} style={{ width: "100%", accentColor: "#2D8B4E", height: 6, cursor: "pointer" }} />
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {results.map((result) => {
            const isBmc = result.name === "BMC"
            const savings = result.name !== "BMC" ? result.fees.total - bmcResult.fees.total : 0
            const barWidth = maxFees > 0 ? (result.fees.total / maxFees) * 100 : 0
            const isSelected = selectedPlatform === result.name

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
                    You keep: <span style={{ color: isBmc ? "#2D8B4E" : "#fff", fontWeight: 700 }}>${result.youKeep.toFixed(2)}</span>
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
