"use client"

import React, { useState } from "react"
import { useInvestmentPools, useInvestments, type PoolCarrier } from "@/lib/hooks/useHawalaWallet"

interface InvestmentPoolCardProps {
  pool: {
    id: string
    name: string
    description?: string
    producer_id: string
    target_amount: number
    total_raised: number
    minimum_investment: number
    roi_type: string
    fixed_roi_rate?: number
    revenue_share_percentage?: number
    product_credit_multiplier?: number
    total_investors: number
    progress_percentage: number
    current_balance: number | null
    carrier?: PoolCarrier | null
    start_date?: string
    end_date?: string
  }
  onInvest: (poolId: string, amount: number) => Promise<void>
  producerName?: string
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function InvestmentPoolCard({ pool, onInvest, producerName }: InvestmentPoolCardProps) {
  const [showInvestModal, setShowInvestModal] = useState(false)
  const [amount, setAmount] = useState("")
  const [investing, setInvesting] = useState(false)
  const [error, setError] = useState("")
  const carrier = pool.carrier ?? null

  const getRoiDescription = () => {
    switch (pool.roi_type) {
      case "FIXED_RATE":
        return `${((pool.fixed_roi_rate || 0) * 100).toFixed(1)}% annual return`
      case "REVENUE_SHARE":
        return `${pool.revenue_share_percentage}% of revenue shared`
      case "PRODUCT_CREDIT":
        return `${pool.product_credit_multiplier}x credit on products`
      default:
        return pool.roi_type
    }
  }

  const handleInvest = async () => {
    const investAmount = parseFloat(amount)
    if (investAmount < pool.minimum_investment) {
      setError(`Minimum investment is ${formatCurrency(pool.minimum_investment)}`)
      return
    }

    try {
      setInvesting(true)
      setError("")
      await onInvest(pool.id, investAmount)
      setShowInvestModal(false)
      setAmount("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setInvesting(false)
    }
  }

  return (
    <>
      <div className="border rounded-lg overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{pool.name}</h3>
              {producerName && (
                <p className="text-sm text-gray-500">{producerName}</p>
              )}
              {carrier && (
                <p className="text-sm text-gray-500">
                  Carried by {carrier.org_key}
                  {carrier.verified_as_of && (
                    <span>
                      {" "}
                      ({carrier.verification_status}, IRS file as of{" "}
                      {new Date(carrier.verified_as_of).toLocaleDateString()})
                    </span>
                  )}
                </p>
              )}
            </div>
            <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
              Active
            </span>
          </div>

          {pool.description && (
            <p className="text-gray-600 text-sm mb-4">{pool.description}</p>
          )}

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-500">
                {formatCurrency(pool.total_raised)} raised
              </span>
              <span className="text-gray-500">
                {formatCurrency(pool.target_amount)} goal
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-600 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(pool.progress_percentage, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {pool.progress_percentage.toFixed(0)}% funded • {pool.total_investors} investors
            </p>
          </div>

          {/* ROI Info */}
          <div className="bg-gray-50 rounded-lg p-3 mb-4">
            <p className="text-sm font-medium text-gray-700">Return Type</p>
            <p className="text-green-600 font-semibold">{getRoiDescription()}</p>
          </div>

          {/* Investment Details */}
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div>
              <p className="text-gray-500">Min Investment</p>
              <p className="font-medium">{formatCurrency(pool.minimum_investment)}</p>
            </div>
            {carrier ? (
              <div className="col-span-2 sm:col-span-1">
                <p className="text-gray-500">Funds held by</p>
                <p className="font-medium">{carrier.org_key}</p>
              </div>
            ) : (
              pool.current_balance !== null && (
                <div>
                  <p className="text-gray-500">Pool Balance</p>
                  <p className="font-medium">{formatCurrency(pool.current_balance)}</p>
                </div>
              )
            )}
          </div>
          {carrier ? (
            // A carried pool takes no contribution here: the carrier collects
            // on its own accounts and the store route answers 409 carried_pool.
            // Until the carrier contribution flow exists (L26), say so instead
            // of offering a button that cannot succeed.
            <p className="text-xs text-gray-500">
              Funds are held by the carrier, not by Free Black Market. Contributions to this pool are
              collected by {carrier.org_key}, not here.
            </p>
          ) : (
            <button
              onClick={() => setShowInvestModal(true)}
              className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors"
            >
              Invest Now
            </button>
          )}
        </div>
      </div>

      {/* Investment Modal (uncarried pools only) */}
      {showInvestModal && !carrier && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Invest in {pool.name}</h3>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                Your investment supports local producers and earns you {getRoiDescription()}.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Investment Amount
              </label>
              <input
                type="number"
                min={pool.minimum_investment}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Min: ${formatCurrency(pool.minimum_investment)}`}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>

            {error && (
              <p className="text-red-600 text-sm mb-4">{error}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowInvestModal(false)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleInvest}
                disabled={investing || !amount}
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300"
              >
                {investing ? "Processing..." : "Confirm Investment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

interface InvestmentPoolsGridProps {
  producerId?: string
  producerName?: string
}

export function InvestmentPoolsGrid({ producerId, producerName }: InvestmentPoolsGridProps) {
  const { pools, loading, error, refetch } = useInvestmentPools(producerId)
  const { invest } = useInvestments()

  const handleInvest = async (poolId: string, amount: number) => {
    await invest(poolId, amount)
    refetch()
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-6 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4 mb-4" />
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-4" />
            <div className="h-2 bg-gray-200 rounded w-full mb-4" />
            <div className="h-10 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Error loading investment pools: {error}</p>
      </div>
    )
  }

  if (pools.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No investment pools available at this time.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {pools.map((pool) => (
        <InvestmentPoolCard
          key={pool.id}
          pool={pool}
          onInvest={handleInvest}
          producerName={producerName}
        />
      ))}
    </div>
  )
}

export function InvestmentPoolsSection() {
  const { pools, loading, error, refetch } = useInvestmentPools()
  const { invest } = useInvestments()

  const handleInvest = async (poolId: string, amount: number) => {
    await invest(poolId, amount)
    refetch()
  }

  return (
    <section className="py-12">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Invest in Local Producers
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Support local farms and food producers while earning returns. Your investment
            helps fund sustainable agriculture and brings fresh, local food to your community.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border rounded-lg p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-3/4 mb-4" />
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4" />
                <div className="h-2 bg-gray-200 rounded w-full mb-4" />
                <div className="h-10 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600">Error loading investment pools</p>
          </div>
        ) : pools.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No investment pools available at this time.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {pools.map((pool) => (
              <InvestmentPoolCard
                key={pool.id}
                pool={pool}
                onInvest={handleInvest}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
