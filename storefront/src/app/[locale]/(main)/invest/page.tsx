import { Metadata } from "next"
import { notFound } from "next/navigation"
import { InvestmentPoolsSection } from "@/components/sections/InvestmentPools"
import { phase1ModuleFlags } from "@/lib/feature-flags"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Invest in Local Farms | Farm Fresh Marketplace",
  description: "Support local farms and food producers while earning returns. Browse investment pools and help fund sustainable agriculture.",
}

export default function InvestPage() {
  // A public offer of return-bearing positions on a model
  // docs/POSTURE_A_COMPLIANCE.md records as quiescent. Dark unless the
  // operator turns the offering on deliberately, on both sides.
  if (!phase1ModuleFlags.investmentPools) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-green-700 text-white py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold mb-4">
            Invest in Local Agriculture
          </h1>
          <p className="text-xl text-green-100 max-w-2xl mx-auto">
            Your investment directly supports local farmers and food producers.
            Earn returns while building a more sustainable food system.
          </p>
        </div>
      </div>

      {/* How It Works */}
      <div className="py-12 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-8">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-green-600 text-xl font-bold">1</span>
              </div>
              <h3 className="font-semibold mb-2">Choose a Pool</h3>
              <p className="text-gray-600 text-sm">
                Browse investment pools from local producers and select one that aligns with your values.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-green-600 text-xl font-bold">2</span>
              </div>
              <h3 className="font-semibold mb-2">Invest</h3>
              <p className="text-gray-600 text-sm">
                Invest as little as $1. Your funds help producers expand operations and improve quality.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-green-600 text-xl font-bold">3</span>
              </div>
              <h3 className="font-semibold mb-2">Earn Returns</h3>
              <p className="text-gray-600 text-sm">
                Receive returns as cash, revenue share, or product credits based on the pool type.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Investment Pools */}
      <InvestmentPoolsSection />

      {/* Benefits Section */}
      <div className="py-12 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-8">Why Invest in Local Food?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold text-green-700 mb-2">Community Impact</h3>
              <p className="text-gray-600 text-sm">
                Your investment stays local, supporting family farms and food entrepreneurs.
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold text-green-700 mb-2">Transparent Returns</h3>
              <p className="text-gray-600 text-sm">
                Track your investments and returns in real-time through your wallet dashboard.
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold text-green-700 mb-2">Flexible Options</h3>
              <p className="text-gray-600 text-sm">
                Choose cash returns, revenue sharing, or product credits - whatever works for you.
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-6">
              <h3 className="font-semibold text-green-700 mb-2">Blockchain Secured</h3>
              <p className="text-gray-600 text-sm">
                All transactions are anchored to the Stellar blockchain for transparency and security.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-12 bg-green-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-gray-600 mb-6">
            Create your wallet to start investing in local producers today.
          </p>
          <Link
            href="/wallet"
            className="inline-block bg-green-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors"
          >
            Open Wallet
          </Link>
        </div>
      </div>
    </div>
  )
}
