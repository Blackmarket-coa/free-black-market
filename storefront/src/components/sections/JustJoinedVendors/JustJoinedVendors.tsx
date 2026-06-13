"use client"
import { logger } from "@/lib/logger"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"

const VENDOR_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  producer: { bg: "bg-green-50", text: "text-green-700" },
  garden: { bg: "bg-emerald-50", text: "text-emerald-700" },
  kitchen: { bg: "bg-teal-50", text: "text-teal-700" },
  maker: { bg: "bg-purple-50", text: "text-purple-700" },
  restaurant: { bg: "bg-orange-50", text: "text-orange-700" },
  mutual_aid: { bg: "bg-blue-50", text: "text-blue-700" },
}

interface Vendor {
  id: string
  name: string
  handle: string
  description?: string
  vendor_type: string
  vendor_type_label: string
  photo: string
  profile_url: string
  location: {
    region?: string
    city?: string
    state?: string
  }
  created_at?: string
}

export function JustJoinedVendors() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchVendors() {
      try {
        const response = await fetch(
          "/api/vendors?has_photo=true&sort=newest&limit=5"
        )
        const data = await response.json()
        setVendors(data.vendors || [])
      } catch (error) {
        logger.error("Error fetching recently joined vendors:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchVendors()
  }, [])

  if (!loading && vendors.length === 0) {
    return null
  }

  return (
    <section className="w-full py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="heading-lg font-bold tracking-tight uppercase">
            Just Joined
          </h2>
          <p className="text-gray-500 mt-1">
            Welcome the newest vendors in our community
          </p>
        </div>
        <Link
          href="/vendors"
          className="text-sm font-medium text-green-700 hover:text-green-800 transition-colors whitespace-nowrap"
        >
          View all vendors &rarr;
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse"
            >
              <div className="aspect-square bg-gray-200" />
              <div className="p-3">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {vendors.map((vendor) => {
            const typeColors =
              VENDOR_TYPE_COLORS[vendor.vendor_type] ||
              VENDOR_TYPE_COLORS.producer

            const locationParts: string[] = []
            if (vendor.location?.city) locationParts.push(vendor.location.city)
            if (vendor.location?.state)
              locationParts.push(vendor.location.state)
            if (!locationParts.length && vendor.location?.region)
              locationParts.push(vendor.location.region)
            const locationDisplay = locationParts.join(", ")

            return (
              <Link
                key={vendor.id}
                href={vendor.profile_url}
                className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md hover:border-green-200 transition-all"
              >
                <div className="relative aspect-square">
                  <Image
                    src={vendor.photo}
                    alt={vendor.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute top-2 left-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${typeColors.bg} ${typeColors.text}`}
                    >
                      {vendor.vendor_type_label}
                    </span>
                  </div>
                </div>
                <div className="p-3">
                  <h3 className="font-semibold text-sm text-gray-900 group-hover:text-green-700 transition-colors line-clamp-1">
                    {vendor.name}
                  </h3>
                  {locationDisplay && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                      {locationDisplay}
                    </p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
