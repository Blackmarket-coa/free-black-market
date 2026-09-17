"use client"

import React, { useState } from "react"
import Link from "next/link"
import {
  useWallet,
  useTransactions,
  useBankAccounts,
  useDeposit,
  useWithdraw,
  useInvestments,
} from "@/lib/hooks/useHawalaWallet"

interface TabButtonProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-b-2 border-green-600 text-green-600"
          : "text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  )
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function WalletDashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "transactions" | "deposit" | "withdraw" | "investments">("overview")
  const { wallet, balance, loading: walletLoading, error: walletError, createWallet } = useWallet()
  const { transactions, loading: txLoading } = useTransactions()
  const { bankAccounts, loading: bankLoading } = useBankAccounts()
  const { investments, summary: investmentSummary, loading: investLoading } = useInvestments()
  const { deposit, loading: depositLoading, error: depositError } = useDeposit()
  const { withdraw, loading: withdrawLoading, error: withdrawError } = useWithdraw()

  const [depositAmount, setDepositAmount] = useState("")
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [selectedBank, setSelectedBank] = useState("")
  const [message, setMessage] = useState("")

  if (walletLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4" />
          <div className="h-12 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
    )
  }

  if (walletError) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-red-600">Error loading wallet: {walletError}</p>
        {walletError.includes("Authentication") && (
          <p className="text-gray-600 mt-2">Please sign in to access your wallet.</p>
        )}
      </div>
    )
  }

  if (!wallet) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center">
        <h2 className="text-xl font-semibold mb-4">Create Your Wallet</h2>
        <p className="text-gray-600 mb-6">
          Get started with your digital wallet to fund purchases, invest in local producers, and track your transactions.
        </p>
        <button
          onClick={createWallet}
          className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors"
        >
          Create Wallet
        </button>
      </div>
    )
  }

  const handleDeposit = async () => {
    if (!selectedBank || !depositAmount) return
    try {
      const result = await deposit(selectedBank, parseFloat(depositAmount))
      setMessage(result.message)
      setDepositAmount("")
    } catch (err) {
      // Error is handled by the hook
    }
  }

  const handleWithdraw = async () => {
    if (!selectedBank || !withdrawAmount) return
    try {
      const result = await withdraw(selectedBank, parseFloat(withdrawAmount))
      setMessage(result.message)
      setWithdrawAmount("")
    } catch (err) {
      // Error is handled by the hook
    }
  }

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Header */}
      <div className="p-6 border-b">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Your Wallet</h2>
            <p className="text-sm text-gray-500 mt-1">Account: {wallet.account_number}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Available Balance</p>
            <p className="text-3xl font-bold text-green-600">
              {balance ? formatCurrency(balance.available_balance) : "$0.00"}
            </p>
            {balance && balance.pending_balance > 0 && (
              <p className="text-sm text-gray-500">
                + {formatCurrency(balance.pending_balance)} pending
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b px-6">
        <nav className="flex space-x-8">
          <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
            Overview
          </TabButton>
          <TabButton active={activeTab === "transactions"} onClick={() => setActiveTab("transactions")}>
            Transactions
          </TabButton>
          <TabButton active={activeTab === "deposit"} onClick={() => setActiveTab("deposit")}>
            Deposit
          </TabButton>
          <TabButton active={activeTab === "withdraw"} onClick={() => setActiveTab("withdraw")}>
            Withdraw
          </TabButton>
          <TabButton active={activeTab === "investments"} onClick={() => setActiveTab("investments")}>
            Investments
          </TabButton>
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {message && (
          <div className="mb-4 p-4 bg-green-50 text-green-800 rounded-lg">
            {message}
            <button onClick={() => setMessage("")} className="ml-4 text-green-600 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Total Balance</p>
              <p className="text-xl font-semibold">
                {balance ? formatCurrency(balance.balance) : "$0.00"}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Total Invested</p>
              <p className="text-xl font-semibold text-blue-600">
                {formatCurrency(investmentSummary.total_invested)}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Investment Returns</p>
              <p className="text-xl font-semibold text-green-600">
                +{formatCurrency(investmentSummary.total_returns)}
              </p>
            </div>

            {/* Recent Transactions */}
            <div className="md:col-span-3">
              <h3 className="font-semibold mb-4">Recent Activity</h3>
              {txLoading ? (
                <p className="text-gray-500">Loading...</p>
              ) : transactions.length === 0 ? (
                <p className="text-gray-500">No transactions yet</p>
              ) : (
                <div className="space-y-2">
                  {transactions.slice(0, 5).map((tx) => (
                    <div key={tx.id} className="flex justify-between items-center py-2 border-b">
                      <div>
                        <p className="font-medium">{tx.entry_type.replace(/_/g, " ")}</p>
                        <p className="text-sm text-gray-500">{formatDate(tx.created_at)}</p>
                      </div>
                      <span className={tx.signed_amount >= 0 ? "text-green-600" : "text-red-600"}>
                        {tx.signed_amount >= 0 ? "+" : ""}{formatCurrency(tx.signed_amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "transactions" && (
          <div>
            {txLoading ? (
              <p className="text-gray-500">Loading transactions...</p>
            ) : transactions.length === 0 ? (
              <p className="text-gray-500">No transactions yet</p>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex justify-between items-center py-3 border-b">
                    <div>
                      <p className="font-medium">{tx.entry_type.replace(/_/g, " ")}</p>
                      <p className="text-sm text-gray-500">{tx.description || tx.id}</p>
                      <p className="text-xs text-gray-400">{formatDate(tx.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <span className={`font-semibold ${tx.signed_amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {tx.signed_amount >= 0 ? "+" : ""}{formatCurrency(tx.signed_amount)}
                      </span>
                      <p className="text-xs text-gray-500">{tx.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "deposit" && (
          <div className="max-w-md">
            <h3 className="font-semibold mb-4">Deposit Funds</h3>
            <p className="text-sm text-gray-600 mb-4">
              Transfer funds from your bank account. Fee: 0.8% (max $5)
            </p>

            {bankLoading ? (
              <p className="text-gray-500">Loading bank accounts...</p>
            ) : bankAccounts.filter(b => b.verification_status === "VERIFIED").length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No bank accounts linked</p>
                <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                  Link Bank Account
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Select Bank Account
                  </label>
                  <select
                    value={selectedBank}
                    onChange={(e) => setSelectedBank(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Select account...</option>
                    {bankAccounts
                      .filter(b => b.verification_status === "VERIFIED")
                      .map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.bank_name} ****{bank.account_last_four}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount (USD)
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="10000"
                    step="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="100.00"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">Min: $10, Max: $10,000</p>
                </div>

                {depositError && (
                  <p className="text-red-600 text-sm">{depositError}</p>
                )}

                <button
                  onClick={handleDeposit}
                  disabled={depositLoading || !selectedBank || !depositAmount}
                  className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {depositLoading ? "Processing..." : "Deposit"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "withdraw" && (
          <div className="max-w-md">
            <h3 className="font-semibold mb-4">Withdraw Funds</h3>
            <p className="text-sm text-gray-600 mb-4">
              Transfer funds to your bank account by ACH. Weekly payouts are free; next-day, same-day and instant cost 0.25%, 0.5% and 1%.
            </p>

            {bankLoading ? (
              <p className="text-gray-500">Loading bank accounts...</p>
            ) : bankAccounts.filter(b => b.verification_status === "VERIFIED").length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No bank accounts linked</p>
                <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                  Link Bank Account
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Select Bank Account
                  </label>
                  <select
                    value={selectedBank}
                    onChange={(e) => setSelectedBank(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="">Select account...</option>
                    {bankAccounts
                      .filter(b => b.verification_status === "VERIFIED")
                      .map((bank) => (
                        <option key={bank.id} value={bank.id}>
                          {bank.bank_name} ****{bank.account_last_four}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount (USD)
                  </label>
                  <input
                    type="number"
                    min="10"
                    step="0.01"
                    max={balance?.available_balance || 0}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="100.00"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Available: {balance ? formatCurrency(balance.available_balance) : "$0.00"}
                  </p>
                </div>

                {withdrawError && (
                  <p className="text-red-600 text-sm">{withdrawError}</p>
                )}

                <button
                  onClick={handleWithdraw}
                  disabled={withdrawLoading || !selectedBank || !withdrawAmount}
                  className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {withdrawLoading ? "Processing..." : "Withdraw"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "investments" && (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-600">Total Invested</p>
                <p className="text-xl font-semibold">{formatCurrency(investmentSummary.total_invested)}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-green-600">Total Returns</p>
                <p className="text-xl font-semibold">+{formatCurrency(investmentSummary.total_returns)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">Active Investments</p>
                <p className="text-xl font-semibold">{investmentSummary.active_investments}</p>
              </div>
            </div>

            <h3 className="font-semibold mb-4">Your Investments</h3>
            {investLoading ? (
              <p className="text-gray-500">Loading investments...</p>
            ) : investments.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No investments yet</p>
                <Link href="/producers" className="text-green-600 hover:underline">
                  Browse Producer Pools →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {investments.map((inv) => (
                  <div key={inv.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium">{inv.pool?.name || "Investment Pool"}</h4>
                        <p className="text-sm text-gray-500">
                          {inv.pool?.roi_type.replace(/_/g, " ")} • {inv.source}
                        </p>
                        <p className="text-xs text-gray-400">{formatDate(inv.invested_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency(inv.amount)}</p>
                        {inv.actual_return > 0 && (
                          <p className="text-sm text-green-600">+{formatCurrency(inv.actual_return)}</p>
                        )}
                        <span className={`text-xs px-2 py-1 rounded ${
                          inv.status === "CONFIRMED" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                        }`}>
                          {inv.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
