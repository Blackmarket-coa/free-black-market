"use client"
import { logger } from "@/lib/logger"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import {
  LocationIcon,
  BackIcon,
} from "@/icons"

interface Kitchen {
  id: string
  name: string
  slug: string
  description?: string
  address: string
  city: string
  state: string
  kitchen_type: "community" | "incubator" | "cooperative" | "nonprofit" | "church" | "school" | "municipal"
  status: "planning" | "active" | "renovation" | "closed"
  total_stations: number
  total_sqft: number
  hourly_rate?: number
  cover_image_url?: string
}

interface KitchensLandingPageProps {
  locale: string
}

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  active: { label: "Open", color: "teal" },
  planning: { label: "Coming Soon", color: "blue" },
  renovation: { label: "Under Renovation", color: "amber" },
  closed: { label: "Closed", color: "gray" },
}

const TYPE_LABELS: Record<string, string> = {
  community: "Community Kitchen",
  incubator: "Incubator Kitchen",
  cooperative: "Cooperative Kitchen",
  nonprofit: "Nonprofit Kitchen",
  church: "Faith-Based Kitchen",
  school: "Educational Kitchen",
  municipal: "Municipal Kitchen",
}

// Kitchen icon component
const KitchenIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
  </svg>
)

// Calendar icon for bookings
const CalendarIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)

// Users icon for community
const UsersIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
)

// Star icon for support
const StarIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
  </svg>
)

export function KitchensLandingPage({ locale }: KitchensLandingPageProps) {
  const [kitchens, setKitchens] = useState<Kitchen[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>("all")

  useEffect(() => {
    async function fetchKitchens() {
      try {
        const response = await fetch("/api/kitchens")
        if (response.ok) {
          const data = await response.json()
          setKitchens(data.kitchens || [])
        }
      } catch (err) {
        logger.error("Failed to fetch kitchens:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchKitchens()
  }, [])

  const filteredKitchens = kitchens.filter(kitchen =>
    filter === "all" || kitchen.status === filter
  )

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <section className="mb-12 text-center">
        <div className="max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-2 text-teal-700 font-medium mb-4">
            <KitchenIcon className="w-5 h-5" />
            Community Kitchens
          </span>
          <h1 className="text-4xl md:text-5xl font-serif text-gray-900 mb-4">
            Commercial Kitchens for Your Community
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Find shared-use commercial kitchen space to start or grow your food business.
            Book time, access equipment, and join a community of food entrepreneurs.
          </p>
        </div>
      </section>

      {/* What You Can Do */}
      <section className="mb-12 grid md:grid-cols-3 gap-6">
        <div className="bg-teal-50 rounded-xl p-6 border border-teal-100">
          <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center mb-4">
            <CalendarIcon className="w-5 h-5 text-teal-700" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Book Kitchen Time</h3>
          <p className="text-sm text-gray-600">
            Reserve fully-equipped kitchen stations by the hour, day, or month.
            Perfect for catering, meal prep, or product development.
          </p>
        </div>
        <div className="bg-amber-50 rounded-xl p-6 border border-amber-100">
          <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center mb-4">
            <UsersIcon className="w-5 h-5 text-amber-700" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Join a Community</h3>
          <p className="text-sm text-gray-600">
            Connect with other food entrepreneurs, share resources,
            and learn from experienced kitchen operators.
          </p>
        </div>
        <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <StarIcon className="w-5 h-5 text-blue-700" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-2">Support Local Food</h3>
          <p className="text-sm text-gray-600">
            Help community kitchens expand their capacity and support
            more food entrepreneurs in your area.
          </p>
        </div>
      </section>

      {/* Filter */}
      <div className="mb-8 flex flex-wrap gap-2">
        {["all", "active", "planning", "renovation"].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              filter === status
                ? "bg-teal-700 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {status === "all" ? "All Kitchens" : STATUS_STYLES[status]?.label || status}
          </button>
        ))}
      </div>

      {/* Kitchens Grid */}
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
      ) : filteredKitchens.length === 0 ? (
        <div className="text-center py-16">
          <KitchenIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {filter === "all" ? "No Kitchens Yet" : "No Kitchens in This Status"}
          </h2>
          <p className="text-gray-600 mb-6">
            {filter === "all"
              ? "Community kitchens will appear here once they're added to the marketplace."
              : "Try selecting a different filter to see more kitchens."}
          </p>
          <Link
            href="/producers"
            className="inline-flex items-center gap-2 text-teal-700 hover:text-teal-800 font-medium"
          >
            <BackIcon className="w-4 h-4" />
            Explore Producers Instead
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredKitchens.map((kitchen) => {
            const statusStyle = STATUS_STYLES[kitchen.status] || { label: kitchen.status, color: "gray" }
            return (
              <Link
                key={kitchen.id}
                href={`/kitchens/${kitchen.slug}`}
                className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-teal-200 transition-all"
              >
                <div className="relative h-48">
                  {kitchen.cover_image_url ? (
                    <Image
                      src={kitchen.cover_image_url}
                      alt={kitchen.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
                      <KitchenIcon className="w-16 h-16 text-white/50" />
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      statusStyle.color === "teal" ? "bg-teal-100 text-teal-800" :
                      statusStyle.color === "blue" ? "bg-blue-100 text-blue-800" :
                      statusStyle.color === "amber" ? "bg-amber-100 text-amber-800" :
                      "bg-gray-100 text-gray-800"
                    }`}>
                      {statusStyle.label}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-xs text-teal-700 font-medium mb-1">
                    {TYPE_LABELS[kitchen.kitchen_type] || "Community Kitchen"}
                  </p>
                  <h3 className="font-semibold text-gray-900 group-hover:text-teal-700 transition-colors mb-2">
                    {kitchen.name}
                  </h3>
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <LocationIcon className="w-4 h-4" />
                    {kitchen.city}, {kitchen.state}
                  </p>
                  {kitchen.description && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                      {kitchen.description}
                    </p>
                  )}
                  <div className="flex gap-4 mt-3 text-xs text-gray-500">
                    {kitchen.total_stations > 0 && (
                      <span>{kitchen.total_stations} stations</span>
                    )}
                    {kitchen.total_sqft > 0 && (
                      <span>{kitchen.total_sqft.toLocaleString()} sq ft</span>
                    )}
                    {kitchen.hourly_rate && (
                      <span>${kitchen.hourly_rate}/hr</span>
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

export default KitchensLandingPage
