import { Metadata } from "next"
import Link from "next/link"
import { VENDOR_PANEL_URL } from "@/const"

export const metadata: Metadata = {
  title: "How It Works | Free Black Market",
  description: "Learn how Free Black Market connects you directly with independent creators, farmers, and makers. No middlemen, transparent pricing, and community impact.",
}

// Inline SVG icons
const ShoppingBagIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
)

const UserGroupIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
  </svg>
)

const CurrencyDollarIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const ShieldCheckIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
)

const HeartIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
  </svg>
)

const TruckIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
  </svg>
)

const ChartBarIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
)

const WalletIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
  </svg>
)

const SparklesIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
)

const GlobeIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
  </svg>
)


export default function HowItWorksPage() {
  const buyerSteps = [
    {
      number: "1",
      title: "Browse & Discover",
      description: "Explore products from verified independent creators, farmers, and makers. Filter by category, location, or producer.",
    },
    {
      number: "2",
      title: "See Transparent Pricing",
      description: "Every listing shows exactly where your money goes. 97% to the creator, 3% to the coalition. No hidden fees.",
    },
    {
      number: "3",
      title: "Purchase with Confidence",
      description: "Secure Stripe checkout, an itemised receipt, and a return request you can open from any order page if something arrives wrong or never arrives.",
    },
    {
      number: "4",
      title: "Support Real People",
      description: "Your purchase directly supports independent creators and builds a more equitable economy.",
    },
  ]

  const sellerSteps = [
    {
      number: "1",
      title: "Sign Up Free",
      description: "Create your account in minutes. No upfront costs, no monthly fees, no commitments.",
    },
    {
      number: "2",
      title: "List Your Products",
      description: "Add your products or services with photos, descriptions, and your own pricing. You set the terms.",
    },
    {
      number: "3",
      title: "Receive Orders",
      description: "Get notified when customers order. Manage everything from your vendor dashboard.",
    },
    {
      number: "4",
      title: "Get Paid Fast",
      description: "Receive 97% of every sale via Stripe Connect. Payouts arrive in 2-3 business days.",
    },
  ]

  const features = [
    {
      icon: CurrencyDollarIcon,
      title: "Just 3% Coalition Fee",
      description: "No subscriptions. No monthly fees. No listing fees. No payment processing fees passed to you. Just 3% when you make a sale.",
      color: "bg-green-100 text-green-600",
    },
    {
      icon: ShieldCheckIcon,
      title: "Verified Creators",
      description: "Every provider is verified. See exactly where your products come from and who made them.",
      color: "bg-blue-100 text-blue-600",
    },
    {
      icon: HeartIcon,
      title: "Community First",
      description: "We&apos;re not venture-backed. We&apos;re community-owned. When creators succeed, we all succeed.",
      color: "bg-pink-100 text-pink-600",
    },
    {
      icon: TruckIcon,
      title: "Flexible Fulfillment",
      description: "Ship nationwide, offer local delivery, or set up pickup. You choose how to get products to customers.",
      color: "bg-amber-100 text-amber-600",
    },
    {
      icon: ChartBarIcon,
      title: "Impact Tracking",
      description: "See the real impact of your purchases. Track how much goes directly to creators and local communities.",
      color: "bg-purple-100 text-purple-600",
    },
    {
      icon: WalletIcon,
      title: "Digital Wallet",
      description: "Manage your funds, invest in local producers, and track your transactions all in one place.",
      color: "bg-indigo-100 text-indigo-600",
    },
  ]

  const productTypes = [
    {
      category: "Farm Fresh",
      items: ["Fresh Produce", "Eggs & Dairy", "Meat & Poultry", "Honey & Preserves"],
      icon: "🌱",
    },
    {
      category: "Handmade Goods",
      items: ["Artisan Crafts", "Home Goods", "Jewelry", "Art & Prints"],
      icon: "🎨",
    },
    {
      category: "Food & Beverages",
      items: ["Baked Goods", "Prepared Foods", "Specialty Items", "Beverages"],
      icon: "🍞",
    },
    {
      category: "Digital Products",
      items: ["E-books & Guides", "Templates", "Digital Art", "Online Courses"],
      icon: "💻",
    },
    {
      category: "Services",
      items: ["Consulting", "Creative Services", "Wellness", "Education"],
      icon: "💼",
    },
    {
      category: "Community",
      items: ["Garden Shares", "CSA Boxes", "Co-op Memberships", "Event Tickets"],
      icon: "🤝",
    },
  ]

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-green-800 to-green-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            How Free Black Market Works
          </h1>
          <p className="text-xl md:text-2xl text-green-100 max-w-3xl mx-auto mb-8">
            A marketplace that puts people first. Direct from creators to you,
            with radical transparency and fair compensation.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/categories"
              className="px-8 py-4 bg-white text-green-800 font-semibold rounded-lg hover:bg-green-50 transition-colors"
            >
              Start Shopping
            </Link>
            <Link
              href="/sell"
              className="px-8 py-4 bg-green-700 text-white font-semibold rounded-lg border-2 border-green-500 hover:bg-green-600 transition-colors"
            >
              Become a Provider
            </Link>
          </div>
        </div>
      </section>

      {/* The Simple Promise */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Our Simple Promise
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              No corporate middlemen. No hidden fees. Just a direct connection between
              people who make things and people who value them.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-4xl font-bold text-green-600">97%</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Goes to Creators</h3>
                  <p className="text-gray-600">The people who did the work</p>
                </div>
              </div>
              <p className="text-gray-600">
                When you buy something on Free Black Market, 97 cents of every dollar
                goes directly to the person who made it. No corporate headquarters taking
                a cut. No shareholders to pay.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-4xl font-bold text-blue-600">3%</span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Goes to the Coalition</h3>
                  <p className="text-gray-600">Keeps everything running</p>
                </div>
              </div>
              <p className="text-gray-600">
                Just 3% covers everything: platform operations, payment processing,
                development, and community support. No subscriptions. No additional fees.
                That&apos;s the whole story.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* For Buyers */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium mb-4">
              <ShoppingBagIcon className="w-5 h-5" />
              For Buyers
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Shop with Purpose
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Every purchase tells a story. Know exactly where your money goes
              and who it supports.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {buyerSteps.map((step) => (
              <div key={step.number} className="relative">
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 h-full">
                  <div className="w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center font-bold text-lg mb-4">
                    {step.number}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
                  <p className="text-gray-600">{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/categories"
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-700 text-white font-semibold rounded-lg hover:bg-green-800 transition-colors"
            >
              Browse Products
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* For Sellers */}
      <section className="py-16 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-800 text-green-200 rounded-full text-sm font-medium mb-4">
              <UserGroupIcon className="w-5 h-5" />
              For Providers
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Share on Your Terms
            </h2>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              Whether you&apos;re a farmer, artist, baker, or service provider—
              keep what you earn and build real customer relationships.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {sellerSteps.map((step) => (
              <div key={step.number} className="bg-gray-800 rounded-xl p-6">
                <div className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center font-bold text-lg mb-4">
                  {step.number}
                </div>
                <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                <p className="text-gray-400">{step.description}</p>
              </div>
            ))}
          </div>

          {/* Seller Benefits */}
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            <div className="bg-gray-800/50 rounded-lg p-6 text-center">
              <div className="text-4xl font-bold text-green-400 mb-2">$0</div>
              <p className="text-gray-300">To get started</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-6 text-center">
              <div className="text-4xl font-bold text-green-400 mb-2">2-3 Days</div>
              <p className="text-gray-300">For payouts</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-6 text-center">
              <div className="text-4xl font-bold text-green-400 mb-2">100%</div>
              <p className="text-gray-300">Control over pricing</p>
            </div>
          </div>

          <div className="mt-12 text-center">
            <Link
              href={`${VENDOR_PANEL_URL}/register`}
              className="inline-flex items-center gap-2 px-6 py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-400 transition-colors"
            >
              Get Started Free
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* What You Can Find */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              What You Can Find Here
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              From farm fresh produce to digital products—all from verified independent creators.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {productTypes.map((type) => (
              <div key={type.category} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">{type.icon}</span>
                  <h3 className="text-xl font-semibold text-gray-900">{type.category}</h3>
                </div>
                <ul className="space-y-2">
                  {type.items.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-gray-600">
                      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform Features */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Built Different
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Features designed for transparency, fairness, and community.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div key={feature.title} className="bg-white rounded-xl p-6 shadow-sm">
                <div className={`w-12 h-12 rounded-lg ${feature.color} flex items-center justify-center mb-4`}>
                  <feature.icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Special Programs */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Special Programs
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Beyond transactions—ways to invest in and support your community.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Community Investment */}
            <div className="bg-gradient-to-br from-green-50 to-blue-50 rounded-2xl p-8 border border-green-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                  <ChartBarIcon className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">Community Investment</h3>
              </div>
              <p className="text-gray-700 mb-6">
                Invest directly in local farms and food producers. Support sustainable agriculture
                while earning returns—as cash, revenue share, or product credits.
              </p>
              <ul className="space-y-3 mb-6">
                <li className="flex items-center gap-2 text-gray-700">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Invest as little as $1
                </li>
                <li className="flex items-center gap-2 text-gray-700">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Track investments in real-time
                </li>
                <li className="flex items-center gap-2 text-gray-700">
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Blockchain-secured transactions
                </li>
              </ul>
              <Link
                href="/invest"
                className="inline-flex items-center gap-2 text-green-700 font-semibold hover:text-green-800"
              >
                Learn about investing
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            {/* CSA & Subscriptions */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-8 border border-amber-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                  <SparklesIcon className="w-6 h-6 text-amber-600" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">CSA & Subscriptions</h3>
              </div>
              <p className="text-gray-700 mb-6">
                Subscribe to regular deliveries from your favorite producers.
                Get seasonal produce, artisan goods, or prepared foods on a schedule that works for you.
              </p>
              <ul className="space-y-3 mb-6">
                <li className="flex items-center gap-2 text-gray-700">
                  <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Weekly harvest boxes
                </li>
                <li className="flex items-center gap-2 text-gray-700">
                  <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Seasonal shares with savings
                </li>
                <li className="flex items-center gap-2 text-gray-700">
                  <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Support consistent producer income
                </li>
              </ul>
              <Link
                href="/producers"
                className="inline-flex items-center gap-2 text-amber-700 font-semibold hover:text-amber-800"
              >
                Find producers
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Community Infrastructure */}
          <div className="mt-8 space-y-6">
            <div className="text-center">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Community Infrastructure</h3>
              <p className="text-gray-600">Shared spaces that strengthen local food systems and support community self-determination</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Community Gardens */}
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-2xl p-6 border border-emerald-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                    <GlobeIcon className="w-5 h-5 text-emerald-600" />
                  </div>
                  <h4 className="text-xl font-bold text-gray-900">Community Gardens</h4>
                </div>
                <p className="text-gray-700 mb-4 text-sm">
                  Connect with local gardens. Find plots, join work parties,
                  participate in democratic governance, and access fresh produce from collective growing spaces.
                </p>
                <div className="grid grid-cols-2 gap-2 mb-4 text-center">
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-emerald-600">Plot Access</div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-emerald-600">Work Parties</div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-emerald-600">Governance</div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-emerald-600">Harvests</div>
                  </div>
                </div>
                <Link
                  href="/gardens"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors text-sm"
                >
                  Explore Gardens
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>

              {/* Community Kitchens */}
              <div className="bg-gradient-to-br from-teal-50 to-cyan-50 rounded-2xl p-6 border border-teal-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
                    <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                  </div>
                  <h4 className="text-xl font-bold text-gray-900">Community Kitchens</h4>
                </div>
                <p className="text-gray-700 mb-4 text-sm">
                  Find shared-use commercial kitchen space. Book time, access equipment,
                  and grow your food business alongside other community food entrepreneurs.
                </p>
                <div className="grid grid-cols-2 gap-2 mb-4 text-center">
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-teal-600">Book Time</div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-teal-600">Equipment</div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-teal-600">Incubation</div>
                  </div>
                  <div className="bg-white/60 rounded-lg p-2">
                    <div className="text-sm font-bold text-teal-600">Community</div>
                  </div>
                </div>
                <Link
                  href="/kitchens"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition-colors text-sm"
                >
                  Explore Kitchens
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center mb-12">
            Frequently Asked Questions
          </h2>

          <div className="space-y-6">
            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Is this like Etsy or Amazon?
              </h3>
              <p className="text-gray-600">
                No. Those platforms take 15-40% of sales and prioritize their profits over creators.
                We take just 3%, and we&apos;re community-owned—not venture-backed. Our success comes from
                creator success, not from squeezing them for fees.
              </p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                How do providers get paid?
              </h3>
              <p className="text-gray-600">
                Through Stripe Connect. When you make a sale, 97% goes directly to your bank account
                within 2-3 business days. No invoicing, no waiting for thresholds, no complicated processes.
              </p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                What does the 3% coalition fee cover?
              </h3>
              <p className="text-gray-600">
                Everything. Platform hosting, development, payment processing, customer support,
                and community programs. There are no hidden fees, no subscriptions, no listing fees,
                and no payment processing fees passed to providers.
              </p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                What if something goes wrong with my order?
              </h3>
              <p className="text-gray-600">
                Message the provider first — most problems are a shipping delay or a mix-up, and
                they can fix it fastest. If that doesn&apos;t resolve it, open a return request from
                the order page and we&apos;ll review it. You also keep your card issuer&apos;s
                dispute rights on every purchase.
              </p>
              <p className="text-gray-600 mt-2">
                Funds are held in escrow on collective buys, crowdfunding campaigns and creator
                bounties, where money is committed before anything ships. A standard order is paid
                out to the provider on the normal Stripe schedule, so escrow is not what protects
                you there — the return and dispute process is.
              </p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Can I offer food or homemade products?
              </h3>
              <p className="text-gray-600">
                Yes! Many states have cottage food laws that allow home-based food production.
                We&apos;ll help you understand your local requirements during onboarding. We welcome
                farmers, bakers, canners, beekeepers, and all kinds of food makers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-green-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to Join the Movement?
          </h2>
          <p className="text-xl text-green-100 mb-8 max-w-2xl mx-auto">
            Whether you&apos;re shopping or providing, you&apos;re part of building a fairer economy—
            one where creators keep what they earn and communities thrive.
          </p>

          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/categories"
              className="px-8 py-4 bg-white text-green-800 font-semibold rounded-lg hover:bg-green-50 transition-colors"
            >
              Start Shopping
            </Link>
            <Link
              href="/sell"
              className="px-8 py-4 bg-green-700 text-white font-semibold rounded-lg border-2 border-green-500 hover:bg-green-600 transition-colors"
            >
              Become a Provider
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
