import { Metadata } from "next"
import Link from "next/link"
import { VENDOR_PANEL_URL } from "@/const"

export const metadata: Metadata = {
  title: "Vendor Types & Features | Free Black Market",
  description: "Explore the eleven vendor playbooks on Free Black Market - from solo Stalls and maker Ateliers to worker-co-op Workshops, CSA Cycles, community Harvests, and federation Hubs. Learn about vendor and customer features.",
}

// Inline SVG icons
const SparklesIcon = ({ className = "" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
  </svg>
)

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


export default function VendorTypesPage() {
  /**
   * Where each playbook commonly leads — the vendor-progression graph, keyed by
   * display name.
   *
   * Source of truth is `backend/src/modules/playbook/progressions.ts`; this is
   * a copy because the rest of this page is hand-written marketing copy rather
   * than fetched data. `progressions.unit.spec.ts` reads this file and fails if
   * the two diverge, so it cannot drift silently.
   *
   * Hub is absent on purpose: it is the terminal rung of every ladder, so it
   * leads nowhere further. See `docs/VENDOR_PROGRESSIONS.md`.
   */
  const leadsTo: Record<string, string[]> = {
    Stall: ["Kitchen", "Atelier", "Creator", "Service"],
    Atelier: ["Workshop", "Commons"],
    Grove: ["Commons", "Hub"],
    Workshop: ["Commons", "Hub"],
    Commons: ["Hub"],
    Cycle: ["Kitchen", "Hub"],
    Kitchen: ["Hub"],
    Harvest: ["Stall", "Cycle", "Grove", "Workshop"],
    Service: ["Workshop", "Atelier", "Grove"],
    Creator: ["Stall", "Atelier"],
  }

  const vendorTypes = [
    {
      type: "Stall",
      icon: "🛍️",
      tagline: "Solo Seller",
      description: "Stall is the zero-overhead playbook for one person selling what they make, grow, or find. You list, you fulfill, you get paid — no governance screens, no proposals, no committees. The simplest way to start.",
      examples: ["Solo farmers", "Home bakers", "Crafters & artists", "Foragers", "Vintage & thrift resellers", "Backyard growers", "Candle & soap makers", "Hot sauce makers"],
      features: [
        "One-person setup, zero governance overhead",
        "Physical, digital, event & recurring listings",
        "Unique one-of-a-kind item listings",
        "Crowdfunding campaign listings",
        "Opt-in sliding-scale pricing",
        "Opt-in community credits payout",
        "Add more playbook roles later",
        "Keep 97% of every sale",
      ],
      color: "from-amber-50 to-yellow-50",
      borderColor: "border-amber-200",
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      link: "/vendors",
    },
    {
      type: "Atelier",
      icon: "🎨",
      tagline: "Affinity Group of Makers (2–12)",
      description: "Atelier is a small group of makers deciding together by flat consensus — no formal governance imposed. Perfect for a studio, collective, or crew that shares a table, a kiln, or a brand.",
      examples: ["Maker collectives", "Artist studios", "Craft cooperatives", "Zine collectives", "Shared ceramics studios", "Sewing circles", "Small design studios", "Recording collectives"],
      features: [
        "Multi-member payout splits",
        "Informal consensus decision-making",
        "Wholesale & consignment listings",
        "Bookable workshops & classes",
        "Sliding-scale pricing",
        "Community credits payout",
        "Shared product catalog",
        "Event & pop-up listings",
      ],
      color: "from-purple-50 to-indigo-50",
      borderColor: "border-purple-200",
      iconBg: "bg-purple-100",
      iconColor: "text-purple-600",
      link: "/vendors",
    },
    {
      type: "Grove",
      icon: "🌳",
      tagline: "Mutual-Aid Co-op",
      description: "Grove pairs sliding-scale pricing with co-op governance and a volunteer-rich front desk. Built for mutual-aid networks that move food and goods on solidarity terms, with internal scrip for members.",
      examples: ["Food distribution networks", "Community fridges", "Solidarity pantries", "Neighborhood aid networks", "Free stores", "Meal programs", "Resource-sharing collectives", "Community care networks"],
      features: [
        "Sliding-scale pricing first",
        "Volunteer coordination & scheduling",
        "Internal scrip & community credits",
        "Multi-member payout splits",
        "Bookable distribution events",
        "Recurring share listings",
        "Recipient privacy protection",
        "Donation & surplus tracking",
      ],
      color: "from-pink-50 to-rose-50",
      borderColor: "border-pink-200",
      iconBg: "bg-pink-100",
      iconColor: "text-pink-600",
      link: "/vendors",
    },
    {
      type: "Workshop",
      icon: "🔧",
      tagline: "Worker Co-op",
      description: "Workshop is the worker-owned shape: decisions made in sociocratic circles, surplus returned to members as patronage refunds. For crews that own the shop together.",
      examples: ["Worker-owned bakeries", "Print shops", "Bike repair co-ops", "Farm crews", "Cleaning cooperatives", "Woodworking shops", "Brewing co-ops", "Tech co-ops"],
      features: [
        "Sociocratic circle governance",
        "Patronage refunds to members",
        "Multi-member payout splits",
        "Wholesale & consignment listings",
        "Bookable services & classes",
        "Member admission workflow",
        "Sliding-scale pricing",
        "Community credits payout",
      ],
      color: "from-slate-50 to-zinc-50",
      borderColor: "border-slate-200",
      iconBg: "bg-slate-100",
      iconColor: "text-slate-600",
      link: "/vendors",
    },
    {
      type: "Commons",
      icon: "🏛️",
      tagline: "Multi-Stakeholder Co-op",
      description: "Commons is the most complete shape: producers, workers, consumers, and supporters share ownership through elected representatives. For community-owned institutions with many kinds of members.",
      examples: ["Food co-ops", "Community-owned groceries", "Housing co-op storefronts", "Community land trusts", "Credit union markets", "Regional co-op federations", "Community-owned cafés", "Co-op incubators"],
      features: [
        "Multi-stakeholder membership classes",
        "Elected representative governance",
        "Every listing type supported",
        "Patronage & surplus distribution",
        "Multi-member payout splits",
        "Sliding-scale pricing",
        "Community credits payout",
        "Proposal & voting flows",
      ],
      color: "from-blue-50 to-sky-50",
      borderColor: "border-blue-200",
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      link: "/vendors",
    },
    {
      type: "Cycle",
      icon: "🔄",
      tagline: "CSA & Order-Cycle Farm",
      description: "Cycle is the CSA shape: time-bounded seasonal shares, harvest scheduling, and member subscriptions. For farms and producers that sell in cycles rather than one-off orders.",
      examples: ["CSA farms", "Orchards & vineyards", "Herd shares", "Egg subscriptions", "Flower CSAs", "Meat shares", "Grain co-ops", "Fish shares"],
      features: [
        "Seasonal share subscriptions",
        "Order-cycle & harvest scheduling",
        "Recurring delivery routes",
        "Wholesale listings",
        "Bookable farm events",
        "Sliding-scale shares",
        "Community credits payout",
        "Multi-member payout splits",
      ],
      color: "from-emerald-50 to-green-50",
      borderColor: "border-emerald-200",
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      link: "/producers",
    },
    {
      type: "Kitchen",
      icon: "🍳",
      tagline: "Restaurants, Commissaries & Shared Kitchens",
      description: "Kitchen handles menus, reservations, pop-ups, and bookable seatings. One playbook for everyone cooking for the neighborhood — from a restaurant to a shared-use commissary renting out stations.",
      examples: ["Local restaurants", "Food trucks", "Ghost kitchens", "Kitchen incubators", "Shared-use commissaries", "Supper clubs", "Caterers", "Meal prep services"],
      features: [
        "Menu management",
        "Bookable seatings & reservations",
        "Pop-up & event listings",
        "Hourly kitchen station booking",
        "Recurring meal subscriptions",
        "Wholesale listings",
        "Sliding-scale pricing",
        "Food safety compliance tracking",
      ],
      color: "from-red-50 to-orange-50",
      borderColor: "border-red-200",
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      link: "/kitchens",
    },
    {
      type: "Harvest",
      icon: "🌱",
      tagline: "Community Gardens & Collective Harvests",
      description: "Harvest tracks the season, the volunteer roster, and the shared pool. For gardens you can join — where the crop belongs to everyone who tends it.",
      examples: ["Community gardens", "Urban farms", "School gardens", "Church gardens", "Rooftop farms", "Allotment gardens", "Gleaning networks", "Orchard projects"],
      features: [
        "Season & harvest tracking",
        "Volunteer roster & work parties",
        "Shared harvest pool ledger",
        "Plot & membership management",
        "Bookable garden events",
        "Recurring share listings",
        "Sliding-scale pricing",
        "Community credits payout",
      ],
      color: "from-lime-50 to-green-50",
      borderColor: "border-lime-200",
      iconBg: "bg-lime-100",
      iconColor: "text-lime-600",
      link: "/gardens",
    },
    {
      type: "Hub",
      icon: "🕸️",
      tagline: "Federation Hub",
      description: "Hub is the federation shape: many vendors, one storefront, governance shared through a council. For aggregators that carry other people's goods and split the proceeds fairly.",
      examples: ["Food hubs", "Farmers market collectives", "Regional aggregators", "Co-op distribution networks", "Artisan marketplaces", "Multi-farm CSAs", "Delivery collectives", "Buying clubs"],
      features: [
        "Aggregate many vendors in one storefront",
        "Federation council governance",
        "Every listing type supported",
        "Consignment & wholesale flows",
        "Multi-vendor payout routing",
        "Sliding-scale pricing",
        "Community credits payout",
        "Multi-location coordination",
      ],
      color: "from-cyan-50 to-teal-50",
      borderColor: "border-cyan-200",
      iconBg: "bg-cyan-100",
      iconColor: "text-cyan-600",
      link: "/vendors",
    },
    {
      type: "Service",
      icon: "🤝",
      tagline: "Time-Bank & Sliding-Scale Services",
      description: "Service lets you publish booking windows and apply sliding-scale rates. For practitioners offering time on a schedule — with predictable cash flow when you need it.",
      examples: ["Childcare collectives", "Herbalists & bodyworkers", "Repair cafés", "Doulas", "Tutors & educators", "Gardeners for hire", "Bike mechanics", "Time banks"],
      features: [
        "Bookable time slots & windows",
        "Sliding-scale rates",
        "Recurring session subscriptions",
        "Event & workshop listings",
        "Digital resource listings",
        "Opt-in community credits",
        "Multi-member practices",
        "Schedule & availability calendar",
      ],
      color: "from-teal-50 to-cyan-50",
      borderColor: "border-teal-200",
      iconBg: "bg-teal-100",
      iconColor: "text-teal-600",
      link: "/vendors",
    },
    {
      type: "Creator",
      icon: "✨",
      tagline: "Independent Creator",
      description: "Creator gives you memberships, digital drops, and a shows calendar. For independent artists and educators monetizing an audience directly — no platform middlemen.",
      examples: ["Musicians & bands", "Writers & zinesters", "Podcasters", "Streamers", "Photographers", "Course creators", "Illustrators", "Filmmakers"],
      features: [
        "Membership tiers",
        "Digital drops & downloads",
        "Shows & events calendar",
        "Physical merch listings",
        "Crowdfunding campaign listings",
        "Recurring supporter subscriptions",
        "Unique one-of-a-kind releases",
        "Opt-in sliding-scale pricing",
      ],
      color: "from-fuchsia-50 to-purple-50",
      borderColor: "border-fuchsia-200",
      iconBg: "bg-fuchsia-100",
      iconColor: "text-fuchsia-600",
      link: "/vendors",
    },
  ]

  const vendorFeatures = [
    {
      category: "Revenue & Payments",
      icon: "💰",
      items: [
        { name: "97% Revenue Share", description: "Keep 97% of every sale, just 3% coalition fee" },
        { name: "Stripe Connect Payments", description: "Secure, fast payouts in 2-3 business days" },
        { name: "Set Your Own Prices", description: "Full control over your pricing strategy" },
        { name: "No Monthly Fees", description: "Zero subscriptions, listing fees, or hidden charges" },
        { name: "Digital Wallet", description: "Track earnings, manage funds in one place" },
      ],
    },
    {
      category: "Store Management",
      icon: "🏪",
      items: [
        { name: "Product Catalog", description: "Unlimited products with variants, images, and descriptions" },
        { name: "Inventory Management", description: "Track stock levels, get low-stock alerts" },
        { name: "Order Management", description: "Process orders, communicate with customers" },
        { name: "Vacation Mode", description: "Pause orders when you need a break" },
        { name: "Custom Policies", description: "Set your own shipping, returns, and fulfillment rules" },
      ],
    },
    {
      category: "Fulfillment Options",
      icon: "🚚",
      items: [
        { name: "Local Delivery", description: "Set delivery zones, days, and minimum orders" },
        { name: "Customer Pickup", description: "Schedule pickup times and locations" },
        { name: "Shipping", description: "Ship products nationwide with carrier integration" },
        { name: "Market Pickup", description: "Coordinate farmers market and pop-up pickups" },
        { name: "Subscription Deliveries", description: "Recurring delivery schedules for CSAs" },
      ],
    },
    {
      category: "Marketing & Visibility",
      icon: "📢",
      items: [
        { name: "Vendor Profile Pages", description: "Tell your story, showcase your values" },
        { name: "Featured Vendor Status", description: "Get highlighted on homepage and collections" },
        { name: "Review & Rating System", description: "Build trust through customer feedback" },
        { name: "Social Media Links", description: "Connect Instagram, TikTok, Facebook, and more" },
        { name: "External Store Links", description: "Link to Etsy, farmers markets, your website" },
      ],
    },
    {
      category: "Community Programs",
      icon: "🌍",
      items: [
        { name: "CSA Subscriptions", description: "Offer seasonal shares and recurring boxes" },
        { name: "Community Investment", description: "Receive direct investment from supporters" },
        { name: "Collaborative Sales", description: "Partner with other vendors on bundles" },
        { name: "Event Participation", description: "Join virtual markets and community events" },
        { name: "Coalition Governance", description: "Voting rights on platform decisions" },
      ],
    },
    {
      category: "Verification & Trust",
      icon: "✅",
      items: [
        { name: "Verification Badges", description: "Display verified status to build trust" },
        { name: "Certification Display", description: "Show USDA Organic, Fair Trade, and more" },
        { name: "Growing Practices", description: "Highlight organic, regenerative, biodynamic methods" },
        { name: "Location Transparency", description: "Show your region and growing area" },
        { name: "Business Registration", description: "Display licenses and tax information" },
      ],
    },
  ]

  const customerFeatures = [
    {
      category: "Discovery & Shopping",
      icon: "🔍",
      items: [
        { name: "Browse by Playbook", description: "Shop stalls, ateliers, groves, kitchens, harvests, hubs, and more" },
        { name: "Location-Based Search", description: "Find vendors within 10, 25, 50, 100, or 250 miles" },
        { name: "Category Navigation", description: "Browse by product type, collection, or seasonal items" },
        { name: "Vendor Profiles", description: "Learn about vendors, their story, and practices" },
        { name: "Search & Filters", description: "Find exactly what you&apos;re looking for quickly" },
      ],
    },
    {
      category: "Transparency & Trust",
      icon: "👁️",
      items: [
        { name: "Know Your Producer", description: "See who made your food and where it comes from" },
        { name: "Pricing Transparency", description: "97% goes to creator, 3% to coalition - always" },
        { name: "Certification Visibility", description: "See organic, fair trade, and other certifications" },
        { name: "Growing Practices", description: "Understand how your food was produced" },
        { name: "Reviews & Ratings", description: "Read authentic customer experiences" },
      ],
    },
    {
      category: "Account & Orders",
      icon: "📦",
      items: [
        { name: "Order Tracking", description: "Track your orders from purchase to delivery" },
        { name: "Order History", description: "View past purchases and reorder favorites" },
        { name: "Address Management", description: "Save multiple delivery addresses" },
        { name: "Wishlist", description: "Save products to purchase later" },
        { name: "Digital Downloads", description: "Access digital products instantly" },
      ],
    },
    {
      category: "Communication",
      icon: "💬",
      items: [
        { name: "Direct Messaging", description: "Message vendors directly about orders or questions" },
        { name: "Order Updates", description: "Receive notifications about your order status" },
        { name: "Community Feed", description: "Stay updated on vendor news and seasonal offerings" },
        { name: "Review System", description: "Share your experience to help others" },
        { name: "Newsletter", description: "Get updates about new vendors and products" },
      ],
    },
    {
      category: "Subscriptions & Programs",
      icon: "📅",
      items: [
        { name: "CSA Memberships", description: "Subscribe to seasonal produce boxes" },
        { name: "Standing Orders", description: "Set up recurring orders for essentials" },
        { name: "Community Investment", description: "Invest in local producers, earn returns" },
        { name: "Garden Memberships", description: "Join community gardens, reserve plots" },
        { name: "Kitchen Bookings", description: "Book shared kitchen time for your projects" },
      ],
    },
    {
      category: "Payment & Security",
      icon: "🔒",
      items: [
        { name: "Secure Checkout", description: "Industry-standard payment security" },
        { name: "Buyer Protection", description: "Payment held until delivery confirmed" },
        { name: "Multiple Payment Methods", description: "Credit cards, digital wallets, and more" },
        { name: "Digital Wallet", description: "Track purchases, investments, and credits" },
        { name: "Easy Refunds", description: "Simple process when things don't work out" },
      ],
    },
  ]

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-green-800 to-green-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Vendor Types & Platform Features
          </h1>
          <p className="text-xl md:text-2xl text-green-100 max-w-4xl mx-auto mb-8">
            Free Black Market connects communities with local producers, makers, and food infrastructure.
            Every seller runs on one of eleven playbooks — the social form of your business, from solo stall to federation hub — each with specialized features to help you thrive.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/vendors"
              className="px-8 py-4 bg-white text-green-800 font-semibold rounded-lg hover:bg-green-50 transition-colors"
            >
              Browse All Vendors
            </Link>
            <Link
              href="/sell"
              className="px-8 py-4 bg-green-700 text-white font-semibold rounded-lg border-2 border-green-500 hover:bg-green-600 transition-colors"
            >
              Become a Vendor
            </Link>
          </div>
        </div>
      </section>

      {/* Platform Scope Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              What is Free Black Market?
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              A community-owned marketplace that puts people over profit, built on radical transparency
              and fair compensation.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl font-bold text-green-600">97%</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">To Creators</h3>
              <p className="text-gray-600">
                Ninety-seven cents of every dollar goes directly to the people who did the work.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center">
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl font-bold text-blue-600">3%</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Coalition Fee</h3>
              <p className="text-gray-600">
                Just 3% covers everything: platform, payments, development, and community programs.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center">
              <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl font-bold text-purple-600">$0</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Hidden Fees</h3>
              <p className="text-gray-600">
                No subscriptions, no listing fees, no payment processing fees. That&apos;s the whole story.
              </p>
            </div>
          </div>

          <div className="mt-12 bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
            <h3 className="text-2xl font-bold text-gray-900 mb-4 text-center">Our Mission</h3>
            <p className="text-lg text-gray-700 text-center max-w-3xl mx-auto">
              We believe in building local food economies where producers keep what they earn,
              customers know where their food comes from, and communities have access to the
              infrastructure they need to feed themselves. We&apos;re not venture-backed—we&apos;re
              community-owned. When creators succeed, we all succeed.
            </p>
          </div>
        </div>
      </section>

      {/* Vendor Types Section */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium mb-4">
              <UserGroupIcon className="w-5 h-5" />
              Eleven Playbooks
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Community Providers We Support
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              From farms to mutual aid networks, we&apos;ve built specialized tools for every type
              of community food provider.
            </p>
          </div>

          <div className="space-y-8">
            {vendorTypes.map((vendor) => (
              <div
                key={vendor.type}
                className={`bg-gradient-to-br ${vendor.color} rounded-2xl p-8 border ${vendor.borderColor}`}
              >
                <div className="lg:flex lg:gap-8">
                  <div className="lg:w-2/3 mb-6 lg:mb-0">
                    <div className="flex items-center gap-4 mb-4">
                      <div className={`w-14 h-14 rounded-full ${vendor.iconBg} flex items-center justify-center`}>
                        <span className="text-3xl">{vendor.icon}</span>
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-gray-900">{vendor.type}</h3>
                        <p className={`${vendor.iconColor} font-medium`}>{vendor.tagline}</p>
                      </div>
                    </div>

                    <p className="text-gray-700 mb-6">{vendor.description}</p>

                    <div className="mb-6">
                      <h4 className="font-semibold text-gray-900 mb-3">Examples include:</h4>
                      <div className="flex flex-wrap gap-2">
                        {vendor.examples.map((example) => (
                          <span
                            key={example}
                            className="px-3 py-1 bg-white/60 rounded-full text-sm text-gray-700"
                          >
                            {example}
                          </span>
                        ))}
                      </div>
                    </div>

                    {(leadsTo[vendor.type] ?? []).length > 0 ? (
                      <p className="text-sm text-gray-600 mb-6">
                        <span className="font-semibold text-gray-900">
                          Commonly leads to:
                        </span>{" "}
                        {(leadsTo[vendor.type] ?? []).join(", ")} — vendors often
                        move on when what they can make, or how many of them
                        there are, outgrows the setup they started with. Plenty
                        never do.
                      </p>
                    ) : null}

                    <Link
                      href={vendor.link}
                      className={`inline-flex items-center gap-2 px-6 py-3 ${vendor.iconBg} ${vendor.iconColor} font-semibold rounded-lg hover:opacity-90 transition-opacity`}
                    >
                      Browse {vendor.type} vendors
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>

                  <div className="lg:w-1/3">
                    <div className="bg-white/70 rounded-xl p-6">
                      <h4 className="font-semibold text-gray-900 mb-4">Specialized Features</h4>
                      <ul className="space-y-2">
                        {vendor.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
                            <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Vendor Features Section */}
      <section className="py-16 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-800 text-green-200 rounded-full text-sm font-medium mb-4">
              <SparklesIcon className="w-5 h-5" />
              For Vendors
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Vendor Features
            </h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Everything you need to run your business, connect with customers, and grow your community.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {vendorFeatures.map((category) => (
              <div key={category.category} className="bg-gray-800 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{category.icon}</span>
                  <h3 className="text-lg font-semibold">{category.category}</h3>
                </div>
                <ul className="space-y-3">
                  {category.items.map((item) => (
                    <li key={item.name}>
                      <div className="font-medium text-green-400">{item.name}</div>
                      <div className="text-sm text-gray-400">{item.description}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href={`${VENDOR_PANEL_URL}/register`}
              className="inline-flex items-center gap-2 px-8 py-4 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-400 transition-colors"
            >
              Get Started Today
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Customer Features Section */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium mb-4">
              <ShoppingBagIcon className="w-5 h-5" />
              For Customers
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Customer Features
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Shop with purpose, know your producers, and support your local food economy.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {customerFeatures.map((category) => (
              <div key={category.category} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{category.icon}</span>
                  <h3 className="text-lg font-semibold text-gray-900">{category.category}</h3>
                </div>
                <ul className="space-y-3">
                  {category.items.map((item) => (
                    <li key={item.name}>
                      <div className="font-medium text-gray-900">{item.name}</div>
                      <div className="text-sm text-gray-600">{item.description}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/categories"
              className="inline-flex items-center gap-2 px-8 py-4 bg-green-700 text-white font-semibold rounded-lg hover:bg-green-800 transition-colors"
            >
              Start Shopping
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Links Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Explore by Vendor Type
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Jump directly to the vendors you&apos;re looking for.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {vendorTypes.map((vendor) => (
              <Link
                key={vendor.type}
                href={vendor.link}
                className={`bg-gradient-to-br ${vendor.color} rounded-xl p-6 text-center border ${vendor.borderColor} hover:shadow-lg transition-shadow`}
              >
                <span className="text-4xl block mb-2">{vendor.icon}</span>
                <h3 className="font-semibold text-gray-900">{vendor.type}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-green-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-xl text-green-100 mb-8 max-w-2xl mx-auto">
            Whether you&apos;re here to provide or to shop, you&apos;re joining a movement to build
            a fairer, more transparent food economy.
          </p>

          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/categories"
              className="px-8 py-4 bg-white text-green-800 font-semibold rounded-lg hover:bg-green-50 transition-colors"
            >
              Shop Local Producers
            </Link>
            <Link
              href="/sell"
              className="px-8 py-4 bg-green-700 text-white font-semibold rounded-lg border-2 border-green-500 hover:bg-green-600 transition-colors"
            >
              Become a Vendor
            </Link>
          </div>

          <div className="mt-8">
            <Link
              href="/how-it-works"
              className="text-green-200 hover:text-white underline"
            >
              Learn more about how Free Black Market works
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
