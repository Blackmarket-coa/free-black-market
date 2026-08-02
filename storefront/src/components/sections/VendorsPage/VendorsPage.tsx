"use client"
import { logger } from "@/lib/logger"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import useUpdateSearchParams from "@/hooks/useUpdateSearchParams"
import { LocationIcon, SearchIcon, ForwardIcon, LeafIcon } from "@/icons"

const VENDOR_TYPE_OPTIONS = [
  { value: "", label: "All Vendors" },
  { value: "producer", label: "Growers & Producers" },
  { value: "garden", label: "Community Growing Spaces" },
  { value: "kitchen", label: "Shared Kitchens" },
  { value: "maker", label: "Makers & Brands" },
  { value: "restaurant", label: "Food Businesses" },
  { value: "mutual_aid", label: "Community Organizations" },
  { value: "creator", label: "Creators" },
  { value: "general", label: "Businesses" },
]

const RADIUS_OPTIONS = [
  { value: "10", label: "10 miles" },
  { value: "25", label: "25 miles" },
  { value: "50", label: "50 miles" },
  { value: "100", label: "100 miles" },
  { value: "250", label: "250 miles" },
]

const VENDOR_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  producer: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  garden: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  kitchen: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
  maker: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  restaurant: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  mutual_aid: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  creator: { bg: "bg-pink-50", text: "text-pink-700", border: "border-pink-200" },
  general: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" },
}

const VENDOR_TYPE_ICONS: Record<string, string> = {
  producer: "🌱",
  garden: "🌿",
  kitchen: "🍳",
  maker: "🎨",
  restaurant: "🍽️",
  mutual_aid: "🤝",
  creator: "🎬",
  general: "🏪",
}

interface Vendor {
  id: string
  seller_id?: string
  name: string
  handle: string
  description?: string
  vendor_type: string
  vendor_type_label: string
  photo?: string
  location: {
    region?: string
    city?: string
    state?: string
    zip?: string
    latitude?: number
    longitude?: number
    country_code?: string
  }
  practices?: string[]
  certifications?: any[]
  featured?: boolean
  verified?: boolean
  distance?: number | null
  profile_url: string
  year_established?: number
  kitchen_type?: string
  total_stations?: number
  total_sqft?: number
  hourly_rate?: number
  total_plots?: number
  rating?: number
}

interface VendorsPageProps {
  locale: string
}

export function VendorsPage({ locale }: VendorsPageProps) {
  const searchParams = useSearchParams()
  const updateSearchParam = useUpdateSearchParams()

  const vendorType = searchParams.get("vendor_type") || ""

  const setVendorType = (value: string) => {
    updateSearchParam("vendor_type", value || null)
  }

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [zipCode, setZipCode] = useState("")
  const [radiusMiles, setRadiusMiles] = useState("50")
  const [distanceActive, setDistanceActive] = useState(false)
  const [geolocating, setGeolocating] = useState(false)
  const [showDistancePanel, setShowDistancePanel] = useState(false)

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "60" })

      if (vendorType) params.set("vendor_type", vendorType)
      if (search) params.set("search", search)

      if (distanceActive && zipCode) {
        params.set("zip", zipCode)
        params.set("radius_miles", radiusMiles)
      }

      const response = await fetch(`/api/vendors?${params}`)
      const data = await response.json()
      setVendors(data.vendors || [])
    } catch (error) {
      logger.error("Error fetching vendors:", error)
    } finally {
      setLoading(false)
    }
  }, [vendorType, search, distanceActive, zipCode, radiusMiles])

  useEffect(() => {
    const debounce = setTimeout(fetchVendors, 300)
    return () => clearTimeout(debounce)
  }, [fetchVendors])

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return
    setGeolocating(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const params = new URLSearchParams({
          limit: "60",
          lat: position.coords.latitude.toString(),
          lng: position.coords.longitude.toString(),
          radius_miles: radiusMiles,
        })
        if (vendorType) params.set("vendor_type", vendorType)
        if (search) params.set("search", search)

        try {
          const response = await fetch(`/api/vendors?${params}`)
          const data = await response.json()
          setVendors(data.vendors || [])
          setDistanceActive(true)
        } catch (error) {
          logger.error("Error fetching vendors:", error)
        } finally {
          setGeolocating(false)
        }
      },
      () => {
        setGeolocating(false)
      }
    )
  }

  const handleZipSearch = () => {
    if (zipCode.length >= 3) {
      setDistanceActive(true)
    }
  }

  const clearDistanceFilter = () => {
    setDistanceActive(false)
    setZipCode("")
  }

  const getLocationDisplay = (vendor: Vendor) => {
    const parts = []
    if (vendor.location?.city) parts.push(vendor.location.city)
    if (vendor.location?.state) parts.push(vendor.location.state)
    if (!parts.length && vendor.location?.region) parts.push(vendor.location.region)
    return parts.join(", ")
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Shop by Vendor
        </h1>
        <p className="text-gray-600 max-w-3xl">
          Browse all vendors on our marketplace. Discover growers, community spaces,
          shared kitchens, makers, food businesses, and community organizations. Filter by type
          or find vendors near you by entering your zip code.
        </p>
      </div>

      {/* Vendor Type Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {VENDOR_TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => setVendorType(option.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              vendorType === option.value
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {option.value && VENDOR_TYPE_ICONS[option.value] && (
              <span className="mr-1">{VENDOR_TYPE_ICONS[option.value]}</span>
            )}
            {option.label}
          </button>
        ))}
      </div>

      {/* Search & Distance Filters */}
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search vendors by name or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            />
          </div>

          {/* Distance Toggle */}
          <button
            onClick={() => setShowDistancePanel(!showDistancePanel)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-colors whitespace-nowrap ${
              distanceActive
                ? "bg-green-100 border-green-300 text-green-800"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <LocationIcon className="w-4 h-4" />
            {distanceActive ? `Within ${radiusMiles} mi` : "Filter by Distance"}
          </button>
        </div>

        {/* Distance Filter Panel */}
        {showDistancePanel && (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Zip Code
                </label>
                <input
                  type="text"
                  placeholder="Enter zip code..."
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  maxLength={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Radius
                </label>
                <select
                  value={radiusMiles}
                  onChange={(e) => setRadiusMiles(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  {RADIUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleZipSearch}
                disabled={zipCode.length < 3}
                className="px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Search by Zip
              </button>
              <button
                onClick={handleUseMyLocation}
                disabled={geolocating}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                {geolocating ? "Locating..." : "Use My Location"}
              </button>
              {distanceActive && (
                <button
                  onClick={clearDistanceFilter}
                  className="px-4 py-2 text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Results Count */}
      {!loading && (
        <p className="text-sm text-gray-500 mb-4">
          {vendors.length} vendor{vendors.length !== 1 ? "s" : ""} found
          {distanceActive && zipCode && ` within ${radiusMiles} miles of ${zipCode}`}
        </p>
      )}

      {/* Vendors Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse"
            >
              <div className="h-44 bg-gray-200"></div>
              <div className="p-4">
                <div className="h-5 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div className="h-6 bg-gray-200 rounded w-2/3 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      ) : vendors.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg">
          <LeafIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            No Vendors Found
          </h2>
          <p className="text-gray-600 mb-4">
            {distanceActive
              ? "Try expanding your search radius or removing the distance filter."
              : "Try adjusting your search or filters."}
          </p>
          {distanceActive && (
            <button
              onClick={clearDistanceFilter}
              className="text-green-700 hover:text-green-800 font-medium"
            >
              Clear distance filter
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {vendors.map((vendor) => (
            <VendorCard key={vendor.id} vendor={vendor} locationDisplay={getLocationDisplay(vendor)} />
          ))}
        </div>
      )}
    </div>
  )
}

function VendorCard({
  vendor,
  locationDisplay,
}: {
  vendor: Vendor
  locationDisplay: string
}) {
  const typeColors =
    VENDOR_TYPE_COLORS[vendor.vendor_type] || VENDOR_TYPE_COLORS.producer
  const typeIcon = VENDOR_TYPE_ICONS[vendor.vendor_type] || "🏪"

  return (
    <Link
      href={vendor.profile_url}
      className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md hover:border-green-200 transition-all"
    >
      {/* Image */}
      <div className="relative h-44">
        {vendor.photo ? (
          <Image
            src={vendor.photo}
            alt={vendor.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div
            className={`w-full h-full ${typeColors.bg} flex items-center justify-center`}
          >
            <span className="text-5xl">{typeIcon}</span>
          </div>
        )}
        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded ${typeColors.bg} ${typeColors.text}`}
          >
            {vendor.vendor_type_label}
          </span>
        </div>
        <div className="absolute top-2 right-2 flex gap-1.5">
          {vendor.featured && (
            <span className="bg-amber-500 text-white text-xs font-medium px-2 py-0.5 rounded">
              Featured
            </span>
          )}
          {vendor.verified && (
            <span className="bg-green-600 text-white text-xs font-medium px-2 py-0.5 rounded">
              Verified
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-semibold text-gray-900 group-hover:text-green-700 transition-colors line-clamp-1">
            {vendor.name}
          </h3>
          <ForwardIcon className="w-4 h-4 text-gray-400 group-hover:text-green-600 transition-colors flex-shrink-0 mt-0.5" />
        </div>

        {locationDisplay && (
          <p className="text-sm text-gray-500 flex items-center gap-1 mb-2">
            <LocationIcon className="w-3.5 h-3.5 flex-shrink-0" />
            {locationDisplay}
            {vendor.distance != null && (
              <span className="text-green-700 font-medium ml-1">
                ({vendor.distance} mi)
              </span>
            )}
          </p>
        )}

        {vendor.description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-2">
            {vendor.description}
          </p>
        )}

        {/* Type-specific details */}
        <div className="flex flex-wrap gap-1.5 mt-auto">
          {vendor.practices &&
            vendor.practices.slice(0, 2).map((practice: string) => (
              <span
                key={practice}
                className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full"
              >
                {practice.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
            ))}
          {vendor.kitchen_type && (
            <span className="text-xs bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full">
              {vendor.kitchen_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          )}
          {vendor.total_plots != null && vendor.total_plots > 0 && (
            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
              {vendor.total_plots} plots
            </span>
          )}
          {vendor.year_established && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              Est. {vendor.year_established}
            </span>
          )}
          {vendor.certifications && vendor.certifications.length > 0 && (
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
              {typeof vendor.certifications[0] === "string"
                ? vendor.certifications[0]
                : (vendor.certifications[0]?.name || "Certified")}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

export default VendorsPage
