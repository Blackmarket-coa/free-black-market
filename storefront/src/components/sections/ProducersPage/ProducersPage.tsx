"use client"
import { logger } from "@/lib/logger"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { LocationIcon, AwardIcon, SearchIcon, FilterIcon, ForwardIcon, LeafIcon } from "@/icons"

// Growing practice labels
const PRACTICE_LABELS: Record<string, string> = {
  ORGANIC: "Organic",
  CERTIFIED_ORGANIC: "Certified Organic",
  REGENERATIVE: "Regenerative",
  CONVENTIONAL: "Conventional",
  BIODYNAMIC: "Biodynamic",
  PERMACULTURE: "Permaculture",
  HYDROPONIC: "Hydroponic",
  AQUAPONIC: "Aquaponic",
  NO_SPRAY: "No Spray",
  IPM: "IPM",
}

const RADIUS_OPTIONS = [
  { value: "10", label: "10 miles" },
  { value: "25", label: "25 miles" },
  { value: "50", label: "50 miles" },
  { value: "100", label: "100 miles" },
  { value: "250", label: "250 miles" },
]

interface Producer {
  id: string
  name: string
  handle: string
  description?: string
  region?: string
  state?: string
  practices?: string[]
  certifications?: Array<{ name: string }>
  photo?: string
  cover_image?: string
  featured?: boolean
  verified?: boolean
  year_established?: number
  distance?: number | null
}

interface ProducersPageProps {
  locale: string
}

export function ProducersPage({ locale }: ProducersPageProps) {
  const [producers, setProducers] = useState<Producer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showFeatured, setShowFeatured] = useState(false)
  const [zipCode, setZipCode] = useState("")
  const [radiusMiles, setRadiusMiles] = useState("50")
  const [distanceActive, setDistanceActive] = useState(false)
  const [showDistancePanel, setShowDistancePanel] = useState(false)

  const fetchProducers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: "50",
        ...(showFeatured && { featured: "true" }),
        ...(search && { search }),
      })

      if (distanceActive && zipCode) {
        // Look up zip coordinates via geocode API
        const geoRes = await fetch(`/api/geocode?zip=${zipCode}`)
        if (geoRes.ok) {
          const geo = await geoRes.json()
          params.set("lat", String(geo.latitude))
          params.set("lng", String(geo.longitude))
          params.set("radius_miles", radiusMiles)
        }
      }

      const response = await fetch(`/api/producers?${params}`)
      const data = await response.json()
      setProducers(data.producers || [])
    } catch (error) {
      logger.error("Error fetching producers:", error)
    } finally {
      setLoading(false)
    }
  }, [search, showFeatured, distanceActive, zipCode, radiusMiles])

  useEffect(() => {
    const debounce = setTimeout(fetchProducers, 300)
    return () => clearTimeout(debounce)
  }, [fetchProducers])

  const handleZipSearch = () => {
    if (zipCode.length >= 3) {
      setDistanceActive(true)
    }
  }

  const clearDistanceFilter = () => {
    setDistanceActive(false)
    setZipCode("")
  }

  const featuredProducers = producers.filter((p) => p.featured)
  const regularProducers = producers.filter((p) => !p.featured)

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Our Creators</h1>
        <p className="text-gray-600 max-w-2xl">
          Meet the makers, artisans, and entrepreneurs behind your purchases. From handcrafted goods and fresh produce to digital products and professional services—every purchase supports independent creators.
        </p>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search creators by name or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setShowFeatured(!showFeatured)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
            showFeatured
              ? "bg-green-100 border-green-300 text-green-800"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          <FilterIcon className="w-4 h-4" />
          Featured Only
        </button>
        <button
          onClick={() => setShowDistancePanel(!showDistancePanel)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
            distanceActive
              ? "bg-green-100 border-green-300 text-green-800"
              : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          <LocationIcon className="w-4 h-4" />
          {distanceActive ? `Within ${radiusMiles} mi` : "Near Me"}
        </button>
      </div>

      {/* Distance Filter Panel */}
      {showDistancePanel && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 mb-8">
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
              Search
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

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
              <div className="h-48 bg-gray-200"></div>
              <div className="p-4">
                <div className="h-6 bg-gray-200 rounded w-2/3 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Featured Producers */}
          {featuredProducers.length > 0 && !showFeatured && (
            <div className="mb-10">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-amber-500">⭐</span> Featured Creators
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {featuredProducers.slice(0, 2).map((producer) => (
                  <FeaturedProducerCard key={producer.id} producer={producer} />
                ))}
              </div>
            </div>
          )}

          {/* All Producers */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {showFeatured ? "Featured Creators" : "All Creators"}
            </h2>
            {(showFeatured ? producers : regularProducers).length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <LeafIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No creators found matching your criteria.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {(showFeatured ? producers : regularProducers).map((producer) => (
                  <ProducerCard key={producer.id} producer={producer} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function FeaturedProducerCard({ producer }: { producer: Producer }) {
  return (
    <Link
      href={`/producers/${producer.handle}`}
      className="group bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200 overflow-hidden hover:shadow-lg transition-shadow"
    >
      <div className="relative h-56">
        {producer.cover_image || producer.photo ? (
          <Image
            src={producer.cover_image || producer.photo!}
            alt={producer.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-green-200 to-emerald-200 flex items-center justify-center">
            <LeafIcon className="w-16 h-16 text-green-500" />
          </div>
        )}
        <div className="absolute top-3 left-3 flex gap-2">
          <span className="bg-amber-500 text-white text-xs font-medium px-2 py-1 rounded">
            ⭐ Featured
          </span>
          {producer.verified && (
            <span className="bg-green-600 text-white text-xs font-medium px-2 py-1 rounded">
              ✓ Verified
            </span>
          )}
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-xl font-semibold text-gray-900 group-hover:text-green-700 transition-colors">
            {producer.name}
          </h3>
          <ForwardIcon className="w-5 h-5 text-gray-400 group-hover:text-green-600 transition-colors" />
        </div>
        {producer.region && (
          <p className="text-sm text-gray-600 flex items-center gap-1 mb-3">
            <LocationIcon className="w-4 h-4" />
            {producer.region}{producer.state ? `, ${producer.state}` : ""}
          </p>
        )}
        {producer.description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-3">{producer.description}</p>
        )}
        {producer.practices && producer.practices.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {producer.practices.slice(0, 3).map((practice) => (
              <span
                key={practice}
                className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full"
              >
                {PRACTICE_LABELS[practice] || practice}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}

function ProducerCard({ producer }: { producer: Producer }) {
  return (
    <Link
      href={`/producers/${producer.handle}`}
      className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md hover:border-green-200 transition-all"
    >
      <div className="relative h-40">
        {producer.photo ? (
          <Image
            src={producer.photo}
            alt={producer.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
            <LeafIcon className="w-12 h-12 text-gray-400" />
          </div>
        )}
        {producer.verified && (
          <span className="absolute top-2 right-2 bg-green-600 text-white text-xs font-medium px-2 py-0.5 rounded">
            ✓ Verified
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 group-hover:text-green-700 transition-colors mb-1">
          {producer.name}
        </h3>
        {producer.region && (
          <p className="text-sm text-gray-500 flex items-center gap-1 mb-2">
            <LocationIcon className="w-3 h-3" />
            {producer.region}{producer.state ? `, ${producer.state}` : ""}
          </p>
        )}
        {producer.practices && producer.practices.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {producer.practices.slice(0, 2).map((practice) => (
              <span
                key={practice}
                className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full"
              >
                {PRACTICE_LABELS[practice] || practice}
              </span>
            ))}
            {producer.practices.length > 2 && (
              <span className="text-xs text-gray-500">
                +{producer.practices.length - 2} more
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

export default ProducersPage
