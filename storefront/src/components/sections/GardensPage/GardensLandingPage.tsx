"use client"
import { logger } from "@/lib/logger"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { 
  LocationIcon, 
  LeafIcon,
  BackIcon,
  SunIcon,
} from "@/icons"

interface Garden {
  id: string
  name: string
  slug: string
  description?: string
  address: string
  city: string
  state: string
  producer_type: "community" | "school" | "church" | "cooperative" | "municipal"
  status: "planning" | "active" | "dormant" | "closed"
  total_plots: number
  total_sqft: number
  cover_image_url?: string
}

interface GardensLandingPageProps {
  locale: string
}

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  active: { label: "Growing Season", color: "green" },
  planning: { label: "Planning Phase", color: "blue" },
  dormant: { label: "Winter Rest", color: "gray" },
  closed: { label: "Closed", color: "red" },
}

const TYPE_LABELS: Record<string, string> = {
  community: "Community Garden",
  school: "School Garden",
  church: "Church Garden",
  cooperative: "Cooperative",
  municipal: "Municipal Garden",
}

export function GardensLandingPage({ locale }: GardensLandingPageProps) {
  const [gardens, setGardens] = useState<Garden[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("all")

  useEffect(() => {
    async function fetchGardens() {
      try {
        const response = await fetch("/api/gardens")
        if (response.ok) {
          const data = await response.json()
          setGardens(data.gardens || [])
        }
      } catch (err) {
        logger.error("Failed to fetch gardens:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchGardens()
  }, [])

  const filteredGardens = gardens.filter(garden => 
    filter === "all" || garden.status === filter
  )

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <section className="mb-12 text-center">
        <div className="max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-2 text-green-700 font-medium mb-4">
            <LeafIcon className="w-5 h-5" />
            Community Gardens
          </span>
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900 mb-4">
            Gardens Growing Near You
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Connect with local community gardens. Support their seasonal needs, 
            volunteer your time, or simply discover what&apos;s growing in your neighborhood.
          </p>
        </div>
      </section>

      {/* What You Can Do */}
      <section className="mb-12 grid md:grid-cols-3 gap-6">
        <div className="bg-green-50 rounded-xl p-6 border border-green-100">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <SunIcon className="w-5 h-5 text-green-700" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Support Seasonal Funding</h3>
          <p className="text-sm text-gray-600">
            Help gardens thrive by contributing to seeds, tools, and infrastructure 
            during critical planning seasons.
          </p>
        </div>
        <div className="bg-amber-50 rounded-xl p-6 border border-amber-100">
          <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center mb-4">
            <LeafIcon className="w-5 h-5 text-amber-700" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Volunteer Your Time</h3>
          <p className="text-sm text-gray-600">
            Join work parties, help with harvests, or share your gardening 
            knowledge with the community.
          </p>
        </div>
        <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <LocationIcon className="w-5 h-5 text-blue-700" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Shop Garden Harvests</h3>
          <p className="text-sm text-gray-600">
            Buy fresh produce directly from gardens when their harvests 
            become available through our marketplace.
          </p>
        </div>
      </section>

      {/* Filter */}
      <div className="mb-8 flex flex-wrap gap-2">
        {["all", "active", "planning", "dormant"].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              filter === status
                ? "bg-green-700 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {status === "all" ? "All Gardens" : STATUS_STYLES[status]?.label || status}
          </button>
        ))}
      </div>

      {/* Gardens Grid */}
      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-48 bg-gray-200 rounded-t-xl"></div>
              <div className="p-4 bg-white border border-t-0 rounded-b-xl">
                <div className="h-6 bg-gray-200 rounded mb-2 w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredGardens.length === 0 ? (
        <div className="text-center py-16">
          <LeafIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {filter === "all" ? "No Gardens Yet" : "No Gardens in This Status"}
          </h2>
          <p className="text-gray-600 mb-6">
            {filter === "all" 
              ? "Community gardens will appear here once they're added to the marketplace."
              : "Try selecting a different filter to see more gardens."}
          </p>
          <Link
            href="/producers"
            className="inline-flex items-center gap-2 text-green-700 hover:text-green-800 font-medium"
          >
            <BackIcon className="w-4 h-4" />
            Explore Producers Instead
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredGardens.map((garden) => {
            const statusStyle = STATUS_STYLES[garden.status] || { label: garden.status, color: "gray" }
            return (
              <Link
                key={garden.id}
                href={`/gardens/${garden.slug}`}
                className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-green-200 transition-all"
              >
                <div className="relative h-48">
                  {garden.cover_image_url ? (
                    <Image
                      src={garden.cover_image_url}
                      alt={garden.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                      <LeafIcon className="w-16 h-16 text-white/50" />
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      statusStyle.color === "green" ? "bg-green-100 text-green-800" :
                      statusStyle.color === "blue" ? "bg-blue-100 text-blue-800" :
                      statusStyle.color === "red" ? "bg-red-100 text-red-800" :
                      "bg-gray-100 text-gray-800"
                    }`}>
                      {statusStyle.label}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-xs text-green-700 font-medium mb-1">
                    {TYPE_LABELS[garden.producer_type] || "Community Garden"}
                  </p>
                  <h3 className="font-semibold text-gray-900 group-hover:text-green-700 transition-colors mb-2">
                    {garden.name}
                  </h3>
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <LocationIcon className="w-4 h-4" />
                    {garden.city}, {garden.state}
                  </p>
                  {garden.description && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                      {garden.description}
                    </p>
                  )}
                  <div className="flex gap-4 mt-3 text-xs text-gray-500">
                    {garden.total_plots > 0 && (
                      <span>{garden.total_plots} plots</span>
                    )}
                    {garden.total_sqft > 0 && (
                      <span>{garden.total_sqft.toLocaleString()} sq ft</span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default GardensLandingPage
