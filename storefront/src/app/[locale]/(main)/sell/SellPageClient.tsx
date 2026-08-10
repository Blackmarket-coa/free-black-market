"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import FeeBreakdown from "@/components/sections/FeeBreakdown"
import { VENDOR_PANEL_URL } from "@/const"
import { GITHUB_REPO_URL } from "@/lib/constants/links"

// Inline SVG icons
const CheckCircleIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const CurrencyDollarIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const UserGroupIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
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

const CalendarIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
)

const ChartBarIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
)



const dashboardShots = [
  {
    title: "Order management",
    image: "/algolia-import.png",
    caption: "Process incoming orders, update statuses, and coordinate fulfillment from one view.",
  },
  {
    title: "Payout tracking",
    image: "/talkjs-placeholder.jpg",
    caption: "Track payouts with clear Stripe Connect visibility and transparent fee math.",
  },
  {
    title: "Vendor messaging",
    image: "/components.jpg",
    caption: "Keep customer communication and fulfillment context in one operational workflow.",
  },
  {
    title: "Impact metrics",
    image: "/crafted.jpg",
    caption: "Measure community outcomes over time and show the impact your operation creates.",
  },
]

/**
 * Join Free Black Market - Community Provider Signup Landing Page
 *
 * Designed following freeblackmarket.com conversion copy principles:
 * - Safety first messaging
 * - Radical transparency
 * - Community over conversion
 *
 * Inclusive of: Farmers, Community Gardens, Mutual Aid Organizations,
 * Community Kitchens, Food Producers, and more
 */
export default function SellPage() {
  const [email, setEmail] = useState("")
  const [storeName, setStoreName] = useState("")
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [accountCreated, setAccountCreated] = useState(false)

  // "Cottage food / home kitchen" is the signal that routes a seller into the
  // cottage-food onboarding step. The other entries describe *what* is sold;
  // this one describes *where it's made*, which is what changes the permits,
  // labels, and limits that apply — a person selling prepared meals from a
  // licensed commissary and one cooking at home have very different paperwork.
  const saleCategories = [
    "Fresh produce",
    "Baked goods",
    "Prepared meals",
    "Cottage food / home kitchen",
    "Pantry staples",
    "Value-added foods",
    "Community programs",
  ]

  // Only list what the vendor panel can actually import today. The backends are
  // `modules/woocommerce-import`, `modules/odoo-import`, the Printful
  // fulfilment integration, and `api/vendor/onboarding/import-csv`. Marketplace
  // sync (`modules/channel-connector`) currently ships one channel, Faire.
  const importChannels = [
    "WooCommerce",
    "Odoo",
    "Printful",
    "CSV",
    "Faire",
    "Manual entry",
  ]

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const registrationParams = new URLSearchParams({
      email,
      store_name: storeName,
      selling: selectedCategories.join(","),
    })

    // Best-effort first-party capture of the signup intent before
    // handing the user off to the vendor-panel registration page.
    // /api/sell-signup forwards to the backend `sell_signup` module;
    // failures are swallowed so the redirect is never blocked.
    try {
      await fetch("/api/sell-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          store_name: storeName,
          selling: selectedCategories,
        }),
        keepalive: true,
      })
    } catch {
      // never block the redirect on capture failure
    }

    window.open(
      `${VENDOR_PANEL_URL}/register?${registrationParams.toString()}`,
      "_blank",
      "noopener,noreferrer"
    )

    setIsSubmitting(false)
    setAccountCreated(true)
  }

  const benefits = [
    {
      icon: CurrencyDollarIcon,
      title: "Keep 97% of Every Transaction",
      description: "Just a 3% coalition fee—that's it. No hidden fees, no monthly charges, no listing fees, no payment processing fees passed to you.",
    },
    {
      icon: UserGroupIcon,
      title: "Direct Customer Relationships",
      description: "Build real connections with your buyers. They're not just customers—they're community members who chose you.",
    },
    {
      icon: ShieldCheckIcon,
      title: "You Set Your Rules",
      description: "Set your own hours, minimum orders, delivery zones. Take vacations when you need them. This is your business.",
    },
    {
      icon: HeartIcon,
      title: "Community, Not Competition",
      description: "We&apos;re building a network where producers help each other. Share knowledge, coordinate deliveries, grow together.",
    },
    {
      icon: CalendarIcon,
      title: "Standing Orders & Subscriptions",
      description: "Build predictable income with recurring orders. Plan ahead with committed customers before you even harvest.",
    },
    {
      icon: ChartBarIcon,
      title: "Transparent Impact Metrics",
      description: "See exactly how your work impacts the community. Track your contribution to local food security.",
    },
  ]

  const providerTypes = [
    "Stall — solo seller",
    "Atelier — small group of makers",
    "Grove — mutual-aid co-op",
    "Workshop — worker co-op",
    "Commons — multi-stakeholder co-op",
    "Cycle — CSA & order-cycle farm",
    "Kitchen — restaurant or shared kitchen",
    "Harvest — community garden",
    "Hub — federation of vendors",
    "Service — bookable time & skills",
    "Creator — audience & digital drops",
  ]

  const faqs = [
    {
      question: "How much does it cost to join?",
      answer: "Nothing upfront. Just 3% to the coalition when you make a sale—that's it. No subscriptions, no monthly fees, no listing fees, no payment processing fees, no hidden charges. If you don't sell, you don't pay.",
    },
    {
      question: "Do I need a commercial kitchen?",
      answer: "It depends on your state's cottage food laws. Many states allow home-based food production for direct sales. We&apos;ll help you understand your local requirements during onboarding.",
    },
    {
      question: "How do I get paid?",
      answer: "We use Stripe Connect for secure, fast payments. You'll receive payouts directly to your bank account, typically within 2-3 business days of each sale.",
    },
    {
      question: "Can I set my own prices?",
      answer: "Absolutely. You know your costs, your time, and your worth. Set prices that let you thrive, not just survive.",
    },
    {
      question: "What if I can't fulfill an order?",
      answer: "Life happens. You can pause orders anytime, set vacation mode, and communicate directly with customers. We&apos;re not here to punish you—we&apos;re here to support you.",
    },
    {
      question: "Is this really different from other platforms?",
      answer: "Yes. We&apos;re community-owned and operated. Our governance gives providers voting rights. We don't compete with you, we work for you. When you succeed, we succeed—that's literally our business model.",
    },
  ]

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-green-900 via-green-800 to-green-900 text-white overflow-hidden">
        <div className="absolute inset-0 bg-[url('/images/produce-pattern.svg')] opacity-5"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              Join in Minutes.
              <br />
              <span className="text-green-300">Start Selling on Your Terms.</span>
            </h1>
            <p className="text-xl md:text-2xl text-green-100 mb-8 leading-relaxed">
              Skip the giant application. Create your account in 30 seconds,
              import what you already sell, and complete payment, shipping,
              and compliance details later.
            </p>

            <div className="bg-white/10 border border-white/20 rounded-xl p-5 mb-8 max-w-3xl">
              <p className="text-sm font-semibold text-green-200 mb-4 uppercase tracking-wide">Sign-up steps</p>
              <ol className="grid sm:grid-cols-2 gap-3 text-sm">
                <li className="rounded-lg bg-white/10 p-3"><span className="font-semibold text-white">1. Create account</span><br />Start in minutes with email + store name.</li>
                <li className="rounded-lg bg-white/10 p-3"><span className="font-semibold text-white">2. Connect payouts</span><br />Use Stripe Connect for secure direct deposits.</li>
                <li className="rounded-lg bg-white/10 p-3"><span className="font-semibold text-white">3. Choose what you sell</span><br />Goods, services, subscriptions, tickets, rentals, or programs.</li>
                <li className="rounded-lg bg-white/10 p-3"><span className="font-semibold text-white">4. Launch storefront</span><br />Publish and manage operations from one dashboard.</li>
              </ol>
              <details className="mt-4 rounded-lg bg-white/10 p-3">
                <summary className="cursor-pointer font-medium text-white">Advanced tools available anytime</summary>
                <p className="text-sm text-green-100 mt-2">Add subscriptions, event ticketing, CSA shares, and impact tracking whenever you are ready. These tools are optional and never block launch.</p>
              </details>
            </div>

            <div className="bg-white/10 border border-white/20 rounded-xl p-5 mb-8 max-w-2xl">
              <p className="text-green-100 text-sm uppercase tracking-wide font-semibold mb-2">Import-first onboarding</p>
              <p className="text-lg font-semibold mb-2">Already selling somewhere else? Bring your store in 5 minutes.</p>
              <p className="text-green-200 text-sm">Import from WooCommerce, Odoo, Printful, Faire, or a CSV and preview before you publish. Etsy, Shopify, Amazon and TikTok Shop are not connected yet — for those, export a CSV and import that.</p>
            </div>
            
            {/* Trust Indicators */}
            <div className="flex flex-wrap gap-4 mb-10">
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full">
                <CheckCircleIcon className="w-5 h-5 text-green-300" />
                <span>Just 3% Coalition Fee</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full">
                <CheckCircleIcon className="w-5 h-5 text-green-300" />
                <span>No Subscriptions</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full">
                <CheckCircleIcon className="w-5 h-5 text-green-300" />
                <span>No Additional Fees</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mb-8">
              <Link href="/feature-matrix" className="rounded-lg bg-white text-green-900 px-4 py-2 text-sm font-semibold">View feature matrix</Link>
              <Link href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/40 text-white px-4 py-2 text-sm font-semibold">Open source transparency</Link>
            </div>
            
            {/* Progressive Signup */}
            {!accountCreated ? (
              <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <p className="text-sm font-semibold text-green-200 mb-2">Step 1 · 30 seconds</p>
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                    className="px-4 py-3 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                  <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Store name"
                    required
                    className="px-4 py-3 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>

                <div>
                  <p className="text-sm text-green-100 mb-2">What do you sell?</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {saleCategories.map((category) => (
                      <label key={category} className="flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(category)}
                          onChange={() => toggleCategory(category)}
                          className="h-4 w-4 rounded border-white/30"
                        />
                        {category}
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || selectedCategories.length === 0}
                  className="px-8 py-4 bg-green-500 hover:bg-green-400 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "Creating your account..." : "Create account & start importing"}
                </button>
              </form>
            ) : (
              <div className="bg-white/10 border border-white/20 px-6 py-6 rounded-lg max-w-3xl space-y-5">
                <div>
                  <p className="text-sm text-green-200 font-semibold">Step 2 · Import products first</p>
                  <p className="text-green-100 mt-1">Your account is live. Pick where to import from now and publish later.</p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {importChannels.map((channel) => (
                    <a
                      key={channel}
                      href={`${VENDOR_PANEL_URL}/products/import`}
                      className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-md px-3 py-2 text-sm text-left"
                    >
                      Import from {channel}
                    </a>
                  ))}
                </div>

                <div className="rounded-md bg-white/5 px-4 py-3">
                  <p className="text-sm text-green-100">Nothing is published until you confirm — every import previews first.</p>
                </div>

                <div>
                  <p className="text-sm text-green-200 font-semibold">Step 3 · Optional later</p>
                  <p className="text-sm text-green-100">Add payout details, shipping preferences, and compliance docs whenever you&apos;re ready.</p>
                </div>
              </div>
            )}

            <p className="mt-4 text-sm text-green-200">
              Free to join. No credit card required. Start now and complete admin details later.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20" data-event="dashboard_showcase_opened" data-event-on-view="true">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border p-6 md:p-8">
            <h2 className="text-2xl md:text-3xl font-semibold mb-2">Inside the vendor dashboard</h2>
            <p className="text-gray-600 mb-6">Core operations are grouped in one place so vendors can run storefronts and community programs without extra tools.</p>
            <div className="grid gap-5 md:grid-cols-2">
              {dashboardShots.map((shot) => (
                <figure key={shot.title} className="rounded-xl border overflow-hidden bg-white">
                  <Image src={shot.image} alt={shot.title} width={640} height={320} className="h-52 w-full object-cover" />
                  <figcaption className="p-4">
                    <p className="font-medium">{shot.title}</p>
                    <p className="text-sm text-gray-600">{shot.caption}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </section>


      {/* Benefits Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Built Different. Built for You.
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              This isn&apos;t another gig platform that sees you as a contractor. 
              We&apos;re building an economy where producers thrive.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {benefits.map((benefit, index) => (
              <div key={index} className="bg-white p-8 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <benefit.icon className="w-12 h-12 text-green-600 mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{benefit.title}</h3>
                <p className="text-gray-600">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who Can Sell Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lg:flex lg:items-center lg:gap-16">
            <div className="lg:w-1/2 mb-12 lg:mb-0">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                If You Grow It or Make It, You Belong Here
              </h2>
              <p className="text-xl text-gray-600 mb-8">
                Whether you&apos;re a backyard gardener with extra tomatoes, a shared-use kitchen
                supporting food entrepreneurs, a community garden feeding your neighbors,
                a mutual aid group distributing food, or a farmer running a small operation—
                there&apos;s a place for you here. When you sign up, a quick quiz matches you to
                one of eleven playbooks—the seller setup shaped around how you actually work.
              </p>
              <div className="flex flex-wrap gap-3">
                {providerTypes.map((type, index) => (
                  <span 
                    key={index}
                    className="px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium"
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>
            <div className="lg:w-1/2">
              <div className="bg-green-900 text-white p-8 rounded-2xl">
                <h3 className="text-2xl font-bold mb-4">The Math That Matters</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-green-700 pb-4">
                    <span>You offer a jar of honey for</span>
                    <span className="text-2xl font-bold">$15.00</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-green-700 pb-4">
                    <span>Coalition fee (3%)</span>
                    <span className="text-xl text-green-300">-$0.45</span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-xl">You receive</span>
                    <span className="text-3xl font-bold text-green-300">$14.55</span>
                  </div>
                </div>
                <p className="mt-6 text-green-200 text-sm">
                  That&apos;s it. No payment processing fees, no hidden charges.
                  Compare that to farmers markets (often 30-40% in fees and time) or
                  grocery stores (where producers see only 10-20% of the retail price).
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust & Transparency Section */}
      <FeeBreakdown />

      {/* Trust & Transparency Section */}
      <section className="py-20 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Radical Transparency
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              We believe you should know exactly how this works and where every dollar goes.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12 max-w-3xl mx-auto">
            <div className="text-center">
              <div className="text-6xl font-bold text-green-400 mb-2">97%</div>
              <div className="text-xl mb-2">Goes to You</div>
              <p className="text-gray-400">
                The producer. The person who did the actual work.
              </p>
            </div>
            <div className="text-center">
              <div className="text-6xl font-bold text-green-400 mb-2">3%</div>
              <div className="text-xl mb-2">Goes to the Coalition</div>
              <p className="text-gray-400">
                Keeps the marketplace running, pays for development, and supports the community.
              </p>
            </div>
          </div>

          <div className="mt-16 text-center">
            <p className="text-gray-300 max-w-2xl mx-auto">
              That&apos;s it. No subscriptions. No additional fees. No payment processing fees passed to you.
              Unlike venture-backed platforms that burn cash to gain market share then raise fees,
              we&apos;re building something sustainable for our community.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center mb-16">
            Questions? Honest Answers.
          </h2>
          
          <div className="space-y-8">
            {faqs.map((faq, index) => (
              <div key={index} className="border-b border-gray-200 pb-8">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">{faq.question}</h3>
                <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-green-900 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to Join on Your Terms?
          </h2>
          <p className="text-xl text-green-100 mb-8 max-w-2xl mx-auto">
            Join a growing community of farmers, gardeners, community kitchens, mutual aid
            groups, and food makers who are building something different. No contracts,
            no commitments, no catch. Just a fair marketplace.
          </p>

          <Link
            href={`${VENDOR_PANEL_URL}/register`}
            className="inline-block px-8 py-4 bg-white text-green-900 font-semibold rounded-lg hover:bg-green-50 transition-colors text-lg"
          >
            Create Your Community Provider Account
          </Link>
          
          <p className="mt-6 text-green-200">
            Already have an account?{" "}
            <Link href={`${VENDOR_PANEL_URL}/login`} className="underline hover:text-white">
              Sign in to your dashboard
            </Link>
          </p>
        </div>
      </section>
    </div>
  )
}
