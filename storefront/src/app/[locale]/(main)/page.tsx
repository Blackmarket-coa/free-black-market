import { logger } from "@/lib/logger"
import {
  BannerSection,
  BlogSection,
  Hero,
  HomeCategories,
  HomeProductSection,
  HomeProductSectionSkeleton,
  ShopByStyleSection,
  JustJoinedVendors,
  HomeDiscoveryModule,
  HomeOpportunityBoard,
} from "@/components/sections"
import { ValueProposition, BecomeProducerCTA } from "@/components/molecules"

import type { Metadata } from "next"
import Link from "next/link"
import { headers } from "next/headers"
import Script from "next/script"
import { Suspense } from "react"
import { listRegions } from "@/lib/data/regions"
import { toHreflang } from "@/lib/helpers/hreflang"

const vendorTypeCards = [
  { label: "Physical Goods", href: "/what-you-sell#physical-goods", emoji: "📦" },
  { label: "Services", href: "/what-you-sell#services", emoji: "🛠️" },
  { label: "CSA / Subscriptions", href: "/what-you-sell#subscriptions-csa", emoji: "🥬" },
  { label: "Digital Products", href: "/what-you-sell#digital-products", emoji: "💻" },
  { label: "Event Tickets", href: "/what-you-sell#event-tickets", emoji: "🎟️" },
  { label: "Rentals", href: "/what-you-sell#rentals", emoji: "🧰" },
  { label: "Community Programs", href: "/community-resources", emoji: "🤝" },
]

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params

  const headersList = await headers()
  const host = headersList.get("host")
  const protocol = headersList.get("x-forwarded-proto") || "https"
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${protocol}://${host}`

  let languages: Record<string, string> = {
    [toHreflang(locale)]: `${baseUrl}/${locale}`,
  }

  try {
    const regions = await listRegions()
    const locales = Array.from(
      new Set(
        (regions ?? [])
          .flatMap((r) => r.countries?.map((c) => c.iso_2) ?? [])
          .filter(Boolean)
      )
    ) as string[]

    languages = locales.reduce<Record<string, string>>((acc, code) => {
      acc[toHreflang(code)] = `${baseUrl}/${code}`
      return acc
    }, {})
  } catch (error) {
    logger.error("[generateMetadata] listRegions failed:", error)
  }

  const title = "Home"
  const description =
    "One platform for producers, creators, organizers, and service providers. Sell goods, offer services, run subscriptions, host events, and track community impact while keeping 97% of every sale."
  const ogImage = "/B2C_Storefront_Open_Graph.png"
  const canonical = `${baseUrl}/${locale}`
  const siteName =
    process.env.NEXT_PUBLIC_SITE_NAME ||
    "Black Market Coalition - Community Commerce Infrastructure"

  return {
    title,
    description,
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical,
      languages: {
        ...languages,
        "x-default": baseUrl,
      },
    },
    openGraph: {
      title: `${title} | ${siteName}`,
      description,
      url: canonical,
      siteName,
      type: "website",
      images: [
        {
          url: ogImage.startsWith("http") ? ogImage : `${baseUrl}${ogImage}`,
          width: 1200,
          height: 630,
          alt: siteName,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [
        ogImage.startsWith("http") ? ogImage : `${baseUrl}${ogImage}`,
      ],
    },
  }
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const headersList = await headers()
  const host = headersList.get("host")
  const protocol = headersList.get("x-forwarded-proto") || "https"
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${protocol}://${host}`

  const siteName =
    process.env.NEXT_PUBLIC_SITE_NAME ||
    "Black Market Coalition"

  const marketplacePathways = [
    {
      title: "Shop products",
      description: "Browse curated goods from independent vendors.",
      href: "/categories",
    },
    {
      title: "Meet vendors",
      description: "See new and established sellers in one place.",
      href: "/vendors",
    },
    {
      title: "Community programs",
      description: "Find local initiatives, events, and mutual-aid offerings.",
      href: "/community-resources",
    },
    {
      title: "Sell on the coalition",
      description: "Get the vendor onboarding checklist and launch your storefront.",
      href: "/sell",
    },
  ]

  return (
    <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start text-primary">
      <link
        rel="preload"
        as="image"
        href="/images/hero/Image.jpg"
      />

      <Script
        id="ld-org"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: siteName,
            url: `${baseUrl}/${locale}`,
            logo: `${baseUrl}/favicon.ico`,
          }),
        }}
      />

      <Script
        id="ld-website"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: siteName,
            url: `${baseUrl}/${locale}`,
            inLanguage: toHreflang(locale),
          }),
        }}
      />

      <Hero
        variant="mission"
        image="/images/hero/Image.jpg"
        heading="Buy direct from real people. Sell on your own terms. Build community wealth."
        paragraph="Free Black Market is community-owned commerce for goods, services, local food and CSA, creators, and mutual aid. Shoppers buy directly from verified makers — no middlemen, no markups. Vendors launch fast and keep 97% of every sale, with a flat 3% coalition fee and no listing, monthly, or processing fees passed to you."
        buttons={[
          {
            label: "Explore the Marketplace",
            path: "/categories",
            eventName: "homepage_primary_cta_clicked",
            eventLabel: "explore_marketplace",
            progressTarget: "product_discovery",
          },
          {
            label: "Join as a Vendor",
            path: "/sell",
            eventName: "homepage_secondary_cta_clicked",
            eventLabel: "join_vendor",
            progressTarget: "signup_start",
          },
        ]}
      />

      <HomeDiscoveryModule />

      <section className="px-4 lg:px-8 w-full">
        <div className="rounded-2xl border p-6 md:p-8 bg-white">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-700 mb-2">Start here</p>
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">Choose what you need in one click</h2>
          <p className="text-gray-600 mb-6">The homepage highlights marketplace discovery first, while vendor setup resources are grouped into a single guided path.</p>
          <div className="mb-6 flex flex-wrap gap-3">
            <Link
              href="/categories"
              className="rounded-lg bg-green-700 px-4 py-2 text-white text-sm font-semibold hover:bg-green-800"
              data-event="homepage_primary_cta_clicked"
              data-event-label="start_shopping"
              data-progress-target="product_discovery"
            >
              Start shopping (primary)
            </Link>
            <Link
              href="/sell"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              data-event="homepage_secondary_cta_clicked"
              data-event-label="become_vendor"
              data-progress-target="signup_start"
            >
              Become a vendor (secondary)
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {marketplacePathways.map((pathway) => (
              <Link
                key={pathway.title}
                href={pathway.href}
                className="rounded-xl border p-4 hover:border-green-400 hover:bg-green-50 transition-colors"
                data-event="homepage_secondary_cta_clicked"
                data-event-label={pathway.title}
                data-progress-target={pathway.href.includes("sell") ? "signup_start" : "product_discovery"}
              >
                <p className="font-semibold mb-1">{pathway.title}</p>
                <p className="text-sm text-gray-600">{pathway.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="px-4 lg:px-8 w-full">
        <Suspense fallback={<HomeProductSectionSkeleton />}>
          <HomeProductSection heading="newly added products" locale={locale} home />
        </Suspense>
      </div>

      <div className="px-4 lg:px-8 w-full">
        <JustJoinedVendors />
      </div>

      <Suspense fallback={null}>
        <HomeOpportunityBoard />
      </Suspense>

      <div className="px-4 lg:px-8 w-full">
        <HomeCategories heading="COMMUNITY PROGRAMS & SALES CHANNELS" />
      </div>

      <section className="px-4 lg:px-8 w-full">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 md:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-700 mb-2">For vendors</p>
          <h2 className="text-3xl font-semibold text-green-900 mb-2">Everything you can run through one storefront stack.</h2>
          <p className="text-green-900/80 mb-4 max-w-2xl">Stop renting your business from extractive platforms. Own your customer relationship, sell across every model from one account, and keep 97% of what you earn — no listing, monthly, or processing fees.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div><span className="font-semibold">Products:</span> physical goods, local food, and digital downloads.</div>
            <div><span className="font-semibold">Services:</span> bookings, custom requests, and provider messaging.</div>
            <div><span className="font-semibold">Subscriptions & CSA:</span> recurring orders and share management.</div>
            <div><span className="font-semibold">Events & Programs:</span> tickets, rentals, and mission-driven initiatives.</div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/what-you-sell" className="rounded-lg bg-green-700 px-4 py-2 text-white text-sm font-medium hover:bg-green-800">See selling models</Link>
            <Link href="/feature-matrix" className="rounded-lg border border-green-300 px-4 py-2 text-green-800 text-sm font-medium hover:bg-green-100">Compare capabilities</Link>
            <Link href="/sell" className="rounded-lg border border-green-300 px-4 py-2 text-green-800 text-sm font-medium hover:bg-green-100" data-event="homepage_primary_cta_clicked" data-event-label="open_vendor_onboarding" data-progress-target="signup_start">Open vendor onboarding</Link>
          </div>
        </div>
      </section>

      <section className="px-4 lg:px-8 w-full">
        <div className="rounded-2xl border p-6 md:p-8">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">Choose your storefront model</h2>
          <p className="text-gray-600 mb-6">Each option goes to one consolidated page with setup guidance, examples, and operational notes.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {vendorTypeCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="rounded-xl border px-4 py-3 hover:border-green-400 hover:bg-green-50 transition-colors"
                data-event="homepage_vendor_type_selected"
                data-event-label={card.label}
              >
                <p className="text-lg">{card.emoji}</p>
                <p className="font-medium">{card.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 lg:px-8 w-full">
        <div className="rounded-2xl border p-6 md:p-8 bg-neutral-50">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">The financials: you keep 97%</h2>
          <p className="text-gray-700 mb-4">A flat 3% coalition fee — and that&apos;s it. No listing fees, no monthly subscription, and no payment processing fees passed to you. Transparent Stripe Connect payouts with vendor-controlled fulfillment.</p>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <div className="rounded-lg bg-white p-4 border"><p className="text-sm text-gray-500">Sale</p><p className="text-xl font-semibold">$100.00</p></div>
            <div className="rounded-lg bg-white p-4 border"><p className="text-sm text-gray-500">Coalition fee (3%)</p><p className="text-xl font-semibold">$3.00</p></div>
            <div className="rounded-lg bg-white p-4 border"><p className="text-sm text-gray-500">You keep</p><p className="text-xl font-semibold text-green-700">$97.00</p></div>
          </div>
          <details className="mb-4 rounded-lg border bg-white p-4" data-event="pricing_breakdown_expanded">
            <summary className="cursor-pointer font-medium text-gray-900">How this compares to typical channels</summary>
            <p className="text-sm text-gray-700 mt-2">Etsy, Shopify, Amazon, and delivery apps stack listing fees, monthly subscriptions, ad spend, and fulfillment charges — often 15–30% all-in. Our model stays simple: one transparent 3% coalition fee. Settle through our internal ledger (Coalition Credits) to move value between members with no card processing cost — an internal payment processor is coming soon.</p>
          </details>
          <Link href="/sell" className="text-green-700 font-medium underline">See this in the vendor onboarding guide</Link>
        </div>
      </section>

      <section className="px-4 lg:px-8 w-full">
        <div className="rounded-2xl border p-6 md:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-700 mb-2">Our goals</p>
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">Building community wealth, not extracting it</h2>
          <p className="text-gray-600 mb-6 max-w-2xl">We&apos;re building the easiest place for communities to earn together — keeping more money local and circulating it among the people who create real value.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <Link href="/gardens" className="rounded-xl border p-4 hover:border-green-400 hover:bg-green-50 transition-colors">
              <p className="font-semibold mb-1">🥬 Local food &amp; agriculture</p>
              <p className="text-gray-600">CSA shares, farm boxes, and order cycles that connect growers directly to neighbors.</p>
            </Link>
            <Link href="/creators" className="rounded-xl border p-4 hover:border-green-400 hover:bg-green-50 transition-colors">
              <p className="font-semibold mb-1">🎨 Creators &amp; vendor marketing</p>
              <p className="text-gray-600">Storefronts, referrals, and audience tools that help makers get discovered and paid.</p>
            </Link>
            <Link href="/community-resources" className="rounded-xl border p-4 hover:border-green-400 hover:bg-green-50 transition-colors">
              <p className="font-semibold mb-1">🤝 Mutual aid &amp; community programs</p>
              <p className="text-gray-600">Fund fridges, free stores, and local initiatives through transparent, fiscally-sponsored giving.</p>
            </Link>
            <Link href="/why-we-exist" className="rounded-xl border p-4 hover:border-green-400 hover:bg-green-50 transition-colors">
              <p className="font-semibold mb-1">🌍 Why we exist</p>
              <p className="text-gray-600">Read the full mission, strategy, and how community governance works.</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="px-4 lg:px-8 w-full">
        <div className="rounded-2xl border border-slate-300 bg-slate-50 p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-2">Open Source. Community Governed.</h2>
          <p className="text-gray-700 mb-4">Improved onboarding system. Built on scalable open-source infrastructure with public transparency.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="https://github.com" target="_blank" rel="noopener noreferrer" className="rounded-lg bg-slate-900 px-4 py-2 text-white text-sm" data-event="github_transparency_link_clicked">View GitHub transparency</Link>
            <Link href="/why-we-exist" className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Why we exist</Link>
          </div>
        </div>
      </section>

      <section className="px-4 lg:px-8 w-full py-12">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-700 mb-2">For shoppers</p>
        <h2 className="text-2xl md:text-3xl font-semibold mb-2">What you get when you buy here</h2>
        <p className="text-gray-600 mb-8 max-w-2xl">No corporate middlemen marking up the things you buy. You pay fair prices, your money reaches the people who actually made your goods, grew your food, or provided your service — and you can see exactly who they are.</p>
        <ValueProposition />
      </section>

      <BannerSection />
      <ShopByStyleSection />

      <div className="px-4 lg:px-8 w-full py-8">
        <BecomeProducerCTA />
      </div>

      <BlogSection />
    </main>
  )
}
