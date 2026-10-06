import { Metadata } from "next"
import { notFound } from "next/navigation"
import { WalletDashboard } from "@/components/sections/WalletDashboard"
import { customerWalletEnabled } from "@/lib/customer-wallet"

export const metadata: Metadata = {
  title: "My Wallet | Farm Fresh Marketplace",
  description: "Manage your digital wallet, view transactions, and invest in local producers.",
}

export default function WalletPage() {
  // The customer wallet (NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1): not found with it off.
  if (!customerWalletEnabled()) notFound()

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">My Wallet</h1>
        <WalletDashboard />
      </div>
    </div>
  )
}
