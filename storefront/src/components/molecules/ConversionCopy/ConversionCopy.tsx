/**
 * FreeBlackMarket.com Conversion Copy Components
 * 
 * "Buy directly from producers. Not corporations. Not middlemen."
 * 
 * These components contain the verbatim conversion copy from the product requirements.
 * They address the core behavioral drivers:
 * - Trust: "Is this safe?"
 * - Value: "Is it worth the price?"
 * - Convenience: "Is this easy?"
 * - Identity: "Does this fit who I am?"
 */

import Link from "next/link"

// Inline SVG Icons (avoiding external dependency)
const ShieldCheckIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
)

const CurrencyDollarIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const HeartIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
  </svg>
)

// ============================================
// Homepage Copy
// ============================================

export const HomePageTagline = () => (
  <p className="text-lg md:text-xl text-warm-600 max-w-xl leading-relaxed">
    Buy directly from creators. Not corporations. Not middlemen.
  </p>
)

export const HomePageHeadline = () => (
  <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif text-warm-900 leading-tight">
    Every dollar you spend here goes straight to the creator who made it.
  </h1>
)

interface ValuePropositionProps {
  className?: string
}

export const ValueProposition = ({ className }: ValuePropositionProps) => (
  <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${className}`}>
    <div className="text-center md:text-left">
      <div className="w-12 h-12 mx-auto md:mx-0 bg-green-100 rounded-lg flex items-center justify-center mb-4">
        <CurrencyDollarIcon className="w-6 h-6 text-green-600" />
      </div>
      <h3 className="font-semibold text-lg mb-2">Direct to Creator</h3>
      <p className="text-gray-600">
        No middlemen. No markups. Creators set their own prices and keep what they earn.
      </p>
    </div>
    <div className="text-center md:text-left">
      <div className="w-12 h-12 mx-auto md:mx-0 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
        <ShieldCheckIcon className="w-6 h-6 text-blue-600" />
      </div>
      <h3 className="font-semibold text-lg mb-2">Verified Sources</h3>
      <p className="text-gray-600">
        Sellers can have their identity, location and practices checked by our team — and
        every profile shows exactly what was verified, not just a tick.
      </p>
    </div>
    <div className="text-center md:text-left">
      <div className="w-12 h-12 mx-auto md:mx-0 bg-amber-100 rounded-lg flex items-center justify-center mb-4">
        <HeartIcon className="w-6 h-6 text-amber-600" />
      </div>
      <h3 className="font-semibold text-lg mb-2">Build Community</h3>
      <p className="text-gray-600">
        Your purchase supports real people and builds a different kind of economy.
      </p>
    </div>
  </div>
)

// ============================================
// Product Page Copy
// ============================================

interface DirectFromProducerProps {
  producerName?: string
  className?: string
}

export const DirectFromProducerMessage = ({ 
  producerName, 
  className 
}: DirectFromProducerProps) => (
  <div className={`bg-green-50 border border-green-200 rounded-lg p-4 ${className}`}>
    <p className="text-green-800 font-medium">
      You&apos;re buying this directly from {producerName || "the person who made it"}.
    </p>
    <p className="text-green-700 text-sm mt-1">
      They set the price. They get paid.
    </p>
  </div>
)

/**
 * Rendered on every product page, so it must not assert anything about the
 * particular seller. It previously read "Verified producer" unconditionally —
 * a per-seller claim made on behalf of sellers who may hold no verification at
 * all. The seller's actual level is shown on their profile, from
 * `vendor_verification`; this banner speaks only to what is true platform-wide.
 */
export const ProductTrustBanner = () => (
  <div className="flex items-center gap-2 text-sm text-gray-600">
    <ShieldCheckIcon className="w-4 h-4 text-green-600" />
    <span>Transparent pricing. Direct from the seller. Buyer protection on every order.</span>
  </div>
)

interface ProducerPriceExplanationProps {
  producerEarnings?: number
  platformFee?: number
  currency?: string
}

export const ProducerPriceExplanation = ({
  producerEarnings = 97,
  platformFee = 3,
  currency = "$",
}: ProducerPriceExplanationProps) => (
  <div className="text-sm text-gray-600 mt-2">
    <span className="font-medium text-green-700">
      {producerEarnings}% goes to the producer.
    </span>
    {" "}A flat {platformFee}% coalition fee keeps the marketplace running — no listing,
    monthly, or payment processing fees passed to vendors.
  </div>
)

// ============================================
// Checkout Copy
// ============================================

interface OrderSummaryImpactProps {
  producerEarnings: string
  producerName?: string
  className?: string
}

export const OrderSummaryImpact = ({
  producerEarnings,
  producerName,
  className,
}: OrderSummaryImpactProps) => (
  <div className={`border-t pt-4 mt-4 ${className}`}>
    <p className="text-sm text-gray-600">
      <span className="font-medium text-green-700">{producerEarnings}</span> of this order goes directly to{" "}
      {producerName || "the producer"}.
    </p>
  </div>
)

// ============================================
// Order Confirmation Copy
// ============================================

interface OrderConfirmationMessageProps {
  producerName?: string
  amount: string
  className?: string
}

export const OrderConfirmationMessage = ({
  producerName,
  amount,
  className,
}: OrderConfirmationMessageProps) => (
  <div className={`bg-green-50 border border-green-200 rounded-lg p-6 text-center ${className}`}>
    <p className="text-xl font-semibold text-green-800 mb-2">
      Thank you for supporting independent creators!
    </p>
    <p className="text-green-700">
      {amount} of this order goes directly to {producerName || "your creator"}.
    </p>
    <p className="text-sm text-green-600 mt-4">
      You&apos;re part of a movement that pays creators fairly and cuts out the middlemen.
    </p>
  </div>
)

// ============================================
// Cart Copy
// ============================================

interface CartImpactSummaryProps {
  totalToProducers: string
  producerCount: number
  className?: string
}

export const CartImpactSummary = ({
  totalToProducers,
  producerCount,
  className,
}: CartImpactSummaryProps) => (
  <div className={`bg-amber-50 border border-amber-200 rounded-lg p-4 ${className}`}>
    <p className="text-amber-800 font-medium">
      Your cart supports {producerCount} independent creator{producerCount !== 1 ? "s" : ""}
    </p>
    <p className="text-amber-700 text-sm mt-1">
      {totalToProducers} goes directly to the people who made your products.
    </p>
  </div>
)

// ============================================
// Trust & Safety Copy
// ============================================

interface VerifiedProducerBadgeProps {
  verificationLevel?: "verified" | "trusted" | "certified"
  className?: string
}

export const VerifiedProducerBadge = ({
  verificationLevel = "verified",
  className,
}: VerifiedProducerBadgeProps) => {
  const labels = {
    verified: "Verified Producer",
    trusted: "Trusted Producer",
    certified: "Certified Producer",
  }
  
  const colors = {
    verified: "bg-green-100 text-green-800 border-green-200",
    trusted: "bg-blue-100 text-blue-800 border-blue-200",
    certified: "bg-purple-100 text-purple-800 border-purple-200",
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${colors[verificationLevel]} ${className}`}>
      <ShieldCheckIcon className="w-3 h-3" />
      {labels[verificationLevel]}
    </span>
  )
}

// ============================================
// Call-to-Action Copy
// ============================================

interface ShopLocalCTAProps {
  href?: string
  className?: string
}

export const ShopLocalCTA = ({ href = "/categories", className }: ShopLocalCTAProps) => (
  <div className={`text-center py-12 ${className}`}>
    <h2 className="text-2xl md:text-3xl font-serif text-warm-900 mb-4">
      Ready to buy direct?
    </h2>
    <p className="text-gray-600 mb-6 max-w-md mx-auto">
      Browse products and services from verified independent creators. Every purchase supports someone building something real.
    </p>
    <Link
      href={href}
      className="inline-flex items-center gap-2 px-6 py-3 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 transition-colors"
    >
      Shop the Market
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  </div>
)

export const BecomeProducerCTA = () => (
  <div className="bg-gradient-to-br from-amber-50 to-green-50 rounded-lg p-8 text-center">
    <h3 className="text-xl font-semibold text-warm-900 mb-2">
      Are you a maker, creator, or community organization?
    </h3>
    <p className="text-gray-600 mb-4">
      Sell products, offer services, or share digital content—on your terms. Build your community. Get compensated fairly.
    </p>
    <Link
      href="/sell"
      className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-green-800 border-2 border-green-200 rounded-lg font-medium hover:border-green-300 hover:bg-green-50 transition-colors"
    >
      Get Started
    </Link>
  </div>
)

// ============================================
// Footer/About Copy
// ============================================

export const MissionStatement = () => (
  <div className="max-w-2xl">
    <h2 className="text-2xl font-serif text-warm-900 mb-4">
      A different kind of marketplace
    </h2>
    <p className="text-gray-600 leading-relaxed">
      We built this platform because we believe the people who grow, make, and create 
      deserve to be paid fairly. No middlemen taking a cut. No algorithms hiding your 
      products. Just a direct connection between you and the people who value what you make.
    </p>
  </div>
)

export const ImpactStats = ({
  totalToProducers = "$1.8M",
  producerCount = 247,
  customerCount = 12580,
}) => (
  <div className="grid grid-cols-3 gap-8 text-center">
    <div>
      <p className="text-3xl font-bold text-green-600">{totalToProducers}</p>
      <p className="text-sm text-gray-600">Paid to Creators</p>
    </div>
    <div>
      <p className="text-3xl font-bold text-blue-600">{producerCount}</p>
      <p className="text-sm text-gray-600">Active Creators</p>
    </div>
    <div>
      <p className="text-3xl font-bold text-amber-600">{customerCount.toLocaleString()}</p>
      <p className="text-sm text-gray-600">Happy Customers</p>
    </div>
  </div>
)

const conversionCopy = {
  HomePageTagline,
  HomePageHeadline,
  ValueProposition,
  DirectFromProducerMessage,
  ProductTrustBanner,
  ProducerPriceExplanation,
  OrderSummaryImpact,
  OrderConfirmationMessage,
  CartImpactSummary,
  VerifiedProducerBadge,
  ShopLocalCTA,
  BecomeProducerCTA,
  MissionStatement,
  ImpactStats,
}

export default conversionCopy
