import type { Metadata } from "next"
import Link from "next/link"

import { getFeeSchedule } from "@/lib/data/fee-schedule"
import { processingCopy } from "@/lib/helpers/processing-copy"

export const metadata: Metadata = {
  title: "What Are You Selling? | Free Black Market",
  description:
    "Choose your community commerce model and review how it works, who it is for, and use cases across goods, services, subscriptions, events, rentals, and programs.",
}

const entries = [
  {
    id: "physical-goods",
    title: "Physical Goods",
    howItWorks: "Create listings, set inventory, and choose local pickup, delivery, or shipping. Orders flow into one dashboard with vendor-controlled fulfillment.",
    who: "Farmers, makers, kitchen brands, and producers selling tangible products.",
    example: "A neighborhood bakery sells weekly bread drops and same-day pickup windows.",
  },
  {
    id: "services",
    title: "Services",
    howItWorks: "Publish service offers, receive direct inquiries, and use messaging + order workflows to scope and deliver each engagement.",
    who: "Consultants, educators, creative providers, and local service professionals.",
    example: "A chef offers private meal prep sessions with custom add-ons.",
  },
  {
    id: "subscriptions-csa",
    title: "CSA / Subscriptions",
    howItWorks: "Set recurring products, fulfillment cadence, and subscriber capacity. Track recurring revenue and upcoming delivery cycles.",
    who: "Farms, gardens, co-ops, and food programs with recurring shares.",
    example: "A 16-week CSA share auto-bills every Friday and updates pickup rosters automatically.",
  },
  {
    id: "digital-products",
    title: "Digital Products",
    howItWorks: "Upload digital assets and deliver secure downloads after checkout. Bundle files with physical products or subscriptions.",
    who: "Designers, educators, and creators selling templates, guides, and media.",
    example: "A herbalist sells printable seasonal wellness guides with instant access.",
  },
  {
    id: "event-tickets",
    title: "Event Tickets",
    howItWorks: "Launch event listings, set ticket quantities, and manage attendance updates with direct customer communication.",
    who: "Organizers, collectives, and educators hosting classes or community events.",
    example: "A cooperative hosts a monthly workshop series and caps each event at 40 attendees.",
  },
  {
    id: "rentals",
    title: "Rentals",
    howItWorks: "List rentable assets, set duration and availability, and coordinate handoff details through messaging.",
    who: "Shared kitchens, tool libraries, and community spaces monetizing underused assets.",
    example: "A shared kitchen rents stations by the hour and tracks equipment usage by booking.",
  },
  {
    id: "community-programs",
    title: "Community Programs",
    howItWorks: "Package mission programs as purchasable or sponsored offerings, then report outcomes using impact metrics.",
    who: "Mutual aid organizations, community gardens, and neighborhood initiatives.",
    example: "A food justice nonprofit runs sponsored produce boxes and reports household impact monthly.",
  },
]

const starterIdeas = {
  products: [
    "Fresh herbs, salad mixes, and microgreens",
    "Seasonal produce bundles and soup boxes",
    "Eggs, honey, and handmade pantry staples",
    "Home-and-garden starter kits (seedlings + care card)",
    "Locally made candles, soaps, and natural body care",
    "Compost, worm castings, and soil amendment packs",
  ],
  services: [
    "Garden setup and seasonal maintenance",
    "Meal prep or batch-cooking support for busy households",
    "Pop-up farm stand management for neighborhoods",
    "Beginner compost coaching and bin setup",
    "Community workshop facilitation (food, herbs, preserving)",
    "Delivery concierge for elders and families",
  ],
  digitalProducts: [
    "Planting calendars by climate zone",
    "Printable garden bed planners and crop rotation sheets",
    "Simple recipe e-books using local/seasonal ingredients",
    "Checklists for kitchen compliance and market prep",
    "Workshop slide decks and class handouts",
    "Social media templates for small food businesses",
  ],
  easyIndoorPlants: [
    "Pothos",
    "Spider plant",
    "Snake plant",
    "Aloe vera",
    "Mint",
    "Basil",
    "Green onions in water",
    "Peace lily",
  ],
  highYieldSmallSpace: [
    "Cherry tomatoes (containers + vertical support)",
    "Pole beans (grow up trellises)",
    "Leaf lettuce (cut-and-come-again harvests)",
    "Radishes (quick turns in shallow containers)",
    "Peppers (compact plants, high output)",
    "Strawberries (hanging baskets or vertical towers)",
    "Cucumbers (vertical growing saves floor space)",
    "Herb mixes (continuous trim-and-regrow)",
  ],
  cottageFoodIdeas: [
    "Fruit jams and jellies",
    "Granola and trail mixes",
    "Spice blends and seasoning salts",
    "Herbal teas",
    "Shelf-stable sauces and syrups",
    "Cookies, breads, and brownies",
  ],
  communityGardenIdeas: [
    "Rentable garden plots with monthly memberships",
    "Seedling starts and transplant sales in spring",
    "Compost pickup + soil-building workshops",
    "Garden classes for kids, schools, and elders",
    "Community-supported flower and herb bundles",
    "Volunteer days with sponsor-backed produce shares",
  ],
  communityKitchenIdeas: [
    "Hourly kitchen station rentals for local cooks",
    "Shared prep packages (off-peak discounted blocks)",
    "Certified food-handler training cohorts",
    "Batch prep + cold storage add-on services",
    "Pop-up dinner and tasting night hosting",
    "Photography corner + content creation for food brands",
  ],
  missedOpportunities: [
    "Event tickets for classes, tastings, and tours",
    "Rental listings (tools, kitchen equipment, canopy setups)",
    "Memberships/subscriptions for weekly staples",
    "Sponsored community boxes (buy one, fund one)",
    "Wholesale packs for local cafes and schools",
    "Corporate wellness or gifting bundles for offices",
  ],
}

const frozenFoodSteps = [
  "Check your state cottage food and frozen food rules first. Labeling and licensing requirements vary by state and county.",
  "Start with products that freeze and reheat well (soups, sauces, dumplings, casseroles, marinated proteins, prepared vegetables).",
  "Use a standard recipe card with exact weights and batch logs for consistency and safety.",
  "Cool quickly, portion immediately, and seal in freezer-safe packaging with clear labels (name, ingredients, allergens, date, reheating instructions).",
  "Set a clear fulfillment process: local pickup windows, insulated delivery options, and strict temperature handling during transport.",
  "Offer starter bundles and subscription packs so customers can stock up and reorder automatically.",
]

const gettingStartedTips = [
  "Start with 3-5 offers only. Launch small, learn what sells, then expand.",
  "Use pre-order windows to estimate demand before production.",
  "Write clear policies for pickup, delivery, substitutions, and refunds.",
  "Take simple, consistent photos in natural light and include dimensions/weights.",
  "Track your true costs (ingredients, labor, packaging, mileage, fees) before setting price.",
  "Bundle related items to increase average order value.",
  "Add one seasonal product every month to stay discoverable and relevant.",
]

const launchChecklists = [
  {
    title: "Physical goods",
    items: [
      "Pick your first 5 products and define weekly inventory limits.",
      "Set one fulfillment mode first (pickup, delivery, or shipping).",
      "Create a packaging checklist so every order is consistent.",
    ],
  },
  {
    title: "Services",
    items: [
      "Create 2–3 clear service packages with starting prices.",
      "Document scope boundaries, turnaround time, and revision policy.",
      "Use intake questions so every inquiry has the same baseline details.",
    ],
  },
  {
    title: "Subscriptions & CSA",
    items: [
      "Define your cadence (weekly/biweekly/monthly) and subscriber cap.",
      "Plan substitutions ahead of time for weather and supply changes.",
      "Publish delivery and pickup calendar dates before launch.",
    ],
  },
  {
    title: "Events, rentals, and programs",
    items: [
      "Set attendance limits and clear check-in instructions.",
      "Include cancellation and reschedule rules directly in listings.",
      "Collect one feedback metric to improve each next session.",
    ],
  },
]

const freeSeedResources = [
  {
    name: "American Seed Swap",
    description: "A free seed exchange where gardeners can request and share seeds.",
    href: "https://www.americanseedswap.com/",
  },
  {
    name: "Seed Savers Exchange",
    description: "Member-driven seed sharing network and educational seed stewardship resources.",
    href: "https://seedsavers.org/",
  },
  {
    name: "National Heirloom Expo - seed education resources",
    description: "Education and access pathways for heirloom seed preservation communities.",
    href: "https://theheirloomexpo.com/",
  },
  {
    name: "Local library seed libraries",
    description: "Many public libraries host free seed libraries. Search your city + 'seed library'.",
    href: "https://www.seedlibraries.net/",
  },
]

export default async function WhatYouSellPage() {
  // Processing sentences render from /store/fee-schedule (Black Mask F6).
  const { processing, default_fee_percent: feePercent } = await getFeeSchedule()
  return (
    <div className="bg-white">
      <section className="bg-green-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="uppercase tracking-wide text-green-300 text-sm font-semibold">Vendor entry points</p>
          <h1 className="text-4xl md:text-5xl font-bold mt-2 mb-4">What Are You Selling?</h1>
          <p className="text-lg text-green-100 max-w-3xl">{processingCopy("whatYouSellIntro", processing, feePercent)}</p>
          <p className="text-base text-green-100/90 mt-3 max-w-3xl">Whether you are a food producer, educator, creative, organizer, or neighborhood collective, this page helps you choose a model and start with a realistic first offer.</p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {entries.map((entry) => (
          <a key={entry.id} href={`#${entry.id}`} className="rounded-xl border p-4 hover:border-green-400 hover:bg-green-50 transition-colors">
            <p className="font-medium">{entry.title}</p>
            <p className="text-sm text-gray-600 mt-1">Tailored setup and workflow</p>
          </a>
        ))}
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 space-y-6">
        {entries.map((entry) => (
          <article id={entry.id} key={entry.id} className="rounded-2xl border p-6 scroll-mt-24">
            <h2 className="text-2xl font-semibold mb-4">{entry.title}</h2>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="font-semibold text-gray-900 mb-1">How it works</p>
                <p className="text-gray-700">{entry.howItWorks}</p>
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Who this is for</p>
                <p className="text-gray-700">{entry.who}</p>
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">Example use case</p>
                <p className="text-gray-700">{entry.example}</p>
              </div>
            </div>
          </article>
        ))}

        <div className="rounded-2xl border bg-green-50 border-green-200 p-6 flex flex-wrap justify-between items-center gap-4">
          <p className="font-medium text-green-900">Need a deeper capability checklist?</p>
          <Link href="/feature-matrix" className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium">View full feature matrix</Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 space-y-8">
        <div>
          <h2 className="text-3xl font-semibold text-gray-900">Seller Starter Ideas</h2>
          <p className="text-gray-700 mt-2 max-w-3xl">
            Use this as a launch kit. Pick one lane, start small, and ship consistently.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">Ideas for products to sell</h3>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.products.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">Ideas for services</h3>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.services.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">Digital products that are easy to launch</h3>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.digitalProducts.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">Easy-to-grow indoor plants</h3>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.easyIndoorPlants.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">High-yield plants for small spaces</h3>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.highYieldSmallSpace.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">Cottage food ideas</h3>
            <p className="mt-2 text-xs text-gray-500">
              Confirm your local cottage food laws before listing products.
            </p>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.cottageFoodIdeas.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">Community garden ideas</h3>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.communityGardenIdeas.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl border p-6">
            <h3 className="text-xl font-semibold">Community kitchen ideas</h3>
            <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
              {starterIdeas.communityKitchenIdeas.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>

        <article className="rounded-2xl border border-blue-200 bg-blue-50 p-6">
          <h3 className="text-xl font-semibold text-blue-900">How to sell frozen food</h3>
          <ol className="mt-3 list-decimal list-inside text-sm text-blue-900 space-y-2">
            {frozenFoodSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="rounded-2xl border p-6">
          <h3 className="text-xl font-semibold">Things you might have missed</h3>
          <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
            {starterIdeas.missedOpportunities.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border p-6">
          <h3 className="text-xl font-semibold">Other ways to get started faster</h3>
          <ul className="mt-3 list-disc list-inside text-sm text-gray-700 space-y-1">
            {gettingStartedTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border p-6">
          <h3 className="text-xl font-semibold">Launch checklists by model</h3>
          <p className="mt-2 text-sm text-gray-600">Use one checklist for your first 30 days to stay focused and consistent.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {launchChecklists.map((checklist) => (
              <div key={checklist.title} className="rounded-xl border bg-gray-50 p-4">
                <p className="font-semibold text-gray-900">{checklist.title}</p>
                <ul className="mt-2 list-disc list-inside text-sm text-gray-700 space-y-1">
                  {checklist.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border p-6">
          <h3 className="text-xl font-semibold">Free seed resources</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {freeSeedResources.map((resource) => (
              <a
                key={resource.name}
                href={resource.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border p-4 hover:bg-green-50 hover:border-green-300 transition-colors"
              >
                <p className="font-medium text-gray-900">{resource.name}</p>
                <p className="mt-1 text-sm text-gray-600">{resource.description}</p>
              </a>
            ))}
          </div>
        </article>

        <div className="rounded-2xl border bg-green-50 border-green-200 p-6 flex flex-wrap justify-between items-center gap-4">
          <div>
            <p className="font-medium text-green-900">Ready to choose your vendor setup?</p>
            <p className="text-sm text-green-800 mt-1">Start with one selling model now and expand once your workflow is stable.</p>
          </div>
          <Link href="/sell" className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium">Start selling</Link>
        </div>
      </section>
    </div>
  )
}
