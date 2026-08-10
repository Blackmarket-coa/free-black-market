"use client"

import { useState } from "react"

/**
 * `WhereYourMoneyGoes` — a split bar showing how a payment divides between the
 * producer, the coalition fee, and (where they apply) delivery and the
 * community fund.
 *
 * This module previously also exported `PriceTransparencyWidget` and
 * `PriceComparison`. Both were rendered by no page, both duplicated
 * `sections/TrustWidget` (which *is* wired into cart review), and
 * `PriceComparison` needed a grocery-store reference price the platform has no
 * source for. They were removed rather than left as a fourth competing fee
 * widget for the next person to pick between.
 */

const InformationCircleIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>
)

interface WhereYourMoneyGoesProps {
  producerPercent: number
  platformPercent: number
  deliveryPercent?: number
  communityPercent?: number
  producerName?: string
  className?: string
}

export const WhereYourMoneyGoes = ({
  producerPercent,
  platformPercent,
  deliveryPercent = 0,
  communityPercent = 0,
  producerName,
  className = "",
}: WhereYourMoneyGoesProps) => {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-left"
        aria-expanded={showDetails}
        aria-label="Show cost breakdown"
      >
        {/* Visual bar */}
        <div className="h-3 rounded-full overflow-hidden flex">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${producerPercent}%` }}
            title={`${producerPercent}% to producer`}
          />
          <div
            className="bg-blue-400 transition-all"
            style={{ width: `${platformPercent}%` }}
            title={`${platformPercent}% coalition fee`}
          />
          {deliveryPercent > 0 && (
            <div
              className="bg-amber-400 transition-all"
              style={{ width: `${deliveryPercent}%` }}
              title={`${deliveryPercent}% delivery`}
            />
          )}
          {communityPercent > 0 && (
            <div
              className="bg-pink-400 transition-all"
              style={{ width: `${communityPercent}%` }}
              title={`${communityPercent}% community fund`}
            />
          )}
        </div>

        {/* Label */}
        <p className="text-sm text-gray-600 mt-1.5 flex items-center gap-1">
          <span className="text-green-600 font-medium">{producerPercent}%</span>
          <span>goes to {producerName || "the producer"}</span>
          <InformationCircleIcon className="w-4 h-4 text-gray-400" />
        </p>
      </button>

      {/* Details tooltip */}
      {showDetails && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDetails(false)}
          />
          <div className="absolute z-50 top-full left-0 mt-2 w-64 p-3 bg-white rounded-lg shadow-lg border">
            <h4 className="font-semibold text-gray-900 mb-2">Cost Breakdown</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                  Producer
                </span>
                <span className="font-medium">{producerPercent}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-400" />
                  Coalition
                </span>
                <span className="font-medium">{platformPercent}%</span>
              </div>
              {deliveryPercent > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-400" />
                    Delivery
                  </span>
                  <span className="font-medium">{deliveryPercent}%</span>
                </div>
              )}
              {communityPercent > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-pink-400" />
                    Community Fund
                  </span>
                  <span className="font-medium">{communityPercent}%</span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-3 pt-3 border-t">
              You&apos;re paying the producer directly. They set the price. They get paid.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
