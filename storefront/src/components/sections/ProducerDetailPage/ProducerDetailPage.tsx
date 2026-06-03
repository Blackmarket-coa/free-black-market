"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { 
  LocationIcon, 
  CalendarIcon, 
  AwardIcon, 
  EarthIcon, 
  BackIcon,
  OpenIcon,
  CartIcon,
  SunIcon,
  LeafIcon,
  DropletsIcon,
  HeartIcon,
  RefreshIcon,
} from "@/icons"

// Growing practice labels and icons
const PRACTICE_INFO: Record<string, { label: string; icon: typeof LeafIcon; color: string }> = {
  ORGANIC: { label: "Organic", icon: LeafIcon, color: "green" },
  CERTIFIED_ORGANIC: { label: "Certified Organic", icon: AwardIcon, color: "green" },
  REGENERATIVE: { label: "Regenerative", icon: SunIcon, color: "amber" },
  CONVENTIONAL: { label: "Conventional", icon: LeafIcon, color: "gray" },
  BIODYNAMIC: { label: "Biodynamic", icon: SunIcon, color: "purple" },
  PERMACULTURE: { label: "Permaculture", icon: LeafIcon, color: "emerald" },
  HYDROPONIC: { label: "Hydroponic", icon: DropletsIcon, color: "blue" },
  AQUAPONIC: { label: "Aquaponic", icon: DropletsIcon, color: "cyan" },
  NO_SPRAY: { label: "No Spray", icon: LeafIcon, color: "lime" },
  IPM: { label: "Integrated Pest Management", icon: LeafIcon, color: "teal" },
}

const SEASON_LABELS: Record<string, string> = {
  SPRING: "Spring",
  SUMMER: "Summer",
  FALL: "Fall",
  WINTER: "Winter",
  YEAR_ROUND: "Year Round",
}

interface Harvest {
  id: string
  crop_name: string
  variety?: string
  harvest_date?: string
  season?: string
  year?: number
  growing_method?: string
  photo?: string
}

interface Product {
  id: string
  title: string
  handle: string
  thumbnail?: string
  status: string
}

interface Producer {
  id: string
  name: string
  handle: string
  description?: string
  region?: string
  state?: string
  country_code?: string
  latitude?: number
  longitude?: number
  farm_size_acres?: number
  year_established?: number
  practices?: string[]
  certifications?: Array<{ name: string; issuer?: string; valid_until?: string; document_url?: string }>
  story?: string
  photo?: string
  cover_image?: string
  gallery?: string[]
  website?: string
  website_url?: string
  social_links?: {
    instagram?: string
    facebook?: string
    twitter?: string
    tiktok?: string
    youtube?: string
    linkedin?: string
    pinterest?: string
  }
  // Normalized external stores from the backend (Commerce Hub).
  external_stores?: { platform: string; name: string; url: string }[]
  featured?: boolean
  verified?: boolean
  harvests?: Harvest[]
  products?: Product[]
  // Support options
  accepts_direct_support?: boolean
  subscription_available?: boolean
  impact_tag?: string
}

interface ProducerDetailPageProps {
  handle: string
  locale: string
}

type TabValue = "buy" | "subscribe" | "support"

export function ProducerDetailPage({ handle, locale }: ProducerDetailPageProps) {
  const [producer, setProducer] = useState<Producer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabValue>("buy")

  useEffect(() => {
    async function fetchProducer() {
      try {
        const response = await fetch(`/api/producers/${handle}`)
        if (!response.ok) {
          throw new Error("Producer not found")
        }
        const data = await response.json()
        setProducer(data.producer)
      } catch (err) {
        setError("Could not load producer information")
      } finally {
        setLoading(false)
      }
    }

    fetchProducer()
  }, [handle])

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-64 bg-gray-200 rounded-xl mb-6"></div>
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="h-4 bg-gray-200 rounded w-2/3 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      </div>
    )
  }

  if (error || !producer) {
    return (
      <div className="text-center py-16">
        <LeafIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Producer Not Found</h2>
        <p className="text-gray-600 mb-4">{error || "This producer profile doesn't exist."}</p>
        <Link
          href="/producers"
          className="inline-flex items-center gap-2 text-green-700 hover:text-green-800"
        >
          <BackIcon className="w-4 h-4" />
          Back to all producers
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Back Link */}
      <Link
        href="/producers"
        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 mb-6"
      >
        <BackIcon className="w-4 h-4" />
        All Producers
      </Link>

      {/* Hero Section */}
      <div className="relative rounded-xl overflow-hidden mb-8">
        {producer.cover_image ? (
          <div className="relative h-64 md:h-80">
            <Image
              src={producer.cover_image}
              alt={producer.name}
              fill
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>
        ) : (
          <div className="h-48 bg-gradient-to-br from-green-500 to-emerald-600" />
        )}
        
        {/* Profile Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          <div className="flex items-end gap-4">
            {producer.photo && (
              <div className="relative w-24 h-24 rounded-xl overflow-hidden border-4 border-white shadow-lg flex-shrink-0">
                <Image
                  src={producer.photo}
                  alt={producer.name}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold">{producer.name}</h1>
                {producer.verified && (
                  <span className="bg-green-500 text-white text-xs font-medium px-2 py-1 rounded">
                    ✓ Verified
                  </span>
                )}
                {producer.featured && (
                  <span className="bg-amber-500 text-white text-xs font-medium px-2 py-1 rounded">
                    ⭐ Featured
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-white/90 flex-wrap">
                {producer.region && (
                  <span className="flex items-center gap-1 text-sm">
                    <LocationIcon className="w-4 h-4" />
                    {producer.region}{producer.state ? `, ${producer.state}` : ""}
                  </span>
                )}
                {producer.year_established && (
                  <span className="flex items-center gap-1 text-sm">
                    <CalendarIcon className="w-4 h-4" />
                    Est. {producer.year_established}
                  </span>
                )}
                {producer.farm_size_acres && (
                  <span className="text-sm">
                    {producer.farm_size_acres} acres
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Growing Practices */}
        {producer.practices && producer.practices.length > 0 && (
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <h3 className="font-medium text-green-800 mb-2 flex items-center gap-2">
              <LeafIcon className="w-4 h-4" />
              Growing Practices
            </h3>
            <div className="flex flex-wrap gap-2">
              {producer.practices.map((practice) => {
                const info = PRACTICE_INFO[practice] || { label: practice, color: "gray" }
                return (
                  <span
                    key={practice}
                    className="text-xs bg-white text-green-800 px-2 py-1 rounded-full border border-green-200"
                  >
                    {info.label}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Certifications */}
        {producer.certifications && producer.certifications.length > 0 && (
          <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
            <h3 className="font-medium text-amber-800 mb-2 flex items-center gap-2">
              <AwardIcon className="w-4 h-4" />
              Certifications
            </h3>
            <div className="flex flex-wrap gap-2">
              {producer.certifications.map((cert, idx) => (
                <div
                  key={idx}
                  className="text-xs bg-white text-amber-800 px-2 py-1 rounded-md border border-amber-200"
                >
                  <div className="font-medium">{cert.name}</div>
                  {cert.valid_until && (
                    <div className="text-[11px] text-amber-700">Valid until: {new Date(cert.valid_until).toLocaleDateString()}</div>
                  )}
                  {cert.document_url && (
                    <a
                      href={cert.document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      View document
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connect - Website & Social Links */}
        {(producer.website || producer.website_url || producer.social_links || (producer.external_stores && producer.external_stores.length > 0)) && (
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <h3 className="font-medium text-blue-800 mb-3 flex items-center gap-2">
              <EarthIcon className="w-4 h-4" />
              Connect
            </h3>
            
            {/* Primary Website */}
            {(producer.website || producer.website_url) && (
              <a
                href={producer.website_url || producer.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-700 hover:text-blue-800 flex items-center gap-1 mb-3"
              >
                Visit Website
                <OpenIcon className="w-3 h-3" />
              </a>
            )}
            
            {/* Social Media Icons */}
            {producer.social_links && Object.values(producer.social_links).some(v => v) && (
              <div className="flex flex-wrap gap-2 mb-3">
                {producer.social_links.instagram && (
                  <a
                    href={producer.social_links.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-pink-600 hover:bg-pink-50 transition-colors border border-blue-200"
                    title="Instagram"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                  </a>
                )}
                {producer.social_links.facebook && (
                  <a
                    href={producer.social_links.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-blue-600 hover:bg-blue-50 transition-colors border border-blue-200"
                    title="Facebook"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </a>
                )}
                {producer.social_links.twitter && (
                  <a
                    href={producer.social_links.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-gray-800 hover:bg-gray-50 transition-colors border border-blue-200"
                    title="Twitter/X"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </a>
                )}
                {producer.social_links.tiktok && (
                  <a
                    href={producer.social_links.tiktok}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-black hover:bg-gray-50 transition-colors border border-blue-200"
                    title="TikTok"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
                    </svg>
                  </a>
                )}
                {producer.social_links.youtube && (
                  <a
                    href={producer.social_links.youtube}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors border border-blue-200"
                    title="YouTube"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                  </a>
                )}
              </div>
            )}
            
            {/* External storefronts (Commerce Hub) */}
            {producer.external_stores && producer.external_stores.length > 0 && (
              <div className="border-t border-blue-200 pt-3">
                <p className="text-xs text-blue-600 mb-2">Also find us on:</p>
                <div className="flex flex-wrap gap-2">
                  {producer.external_stores.map((store, i) => (
                    <a
                      key={`${store.platform}-${i}`}
                      href={store.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-white text-blue-700 px-2 py-1 rounded border border-blue-200 hover:bg-blue-100 transition-colors"
                    >
                      {store.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Three-Tab Layout: Buy / Subscribe / Support */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-0">
          <button
            onClick={() => setActiveTab("buy")}
            className={`flex-1 pb-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
              activeTab === "buy"
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <CartIcon className="w-4 h-4" />
            Buy
          </button>
          <button
            onClick={() => setActiveTab("subscribe")}
            className={`flex-1 pb-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
              activeTab === "subscribe"
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <RefreshIcon className="w-4 h-4" />
            Subscribe
          </button>
          <button
            onClick={() => setActiveTab("support")}
            className={`flex-1 pb-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
              activeTab === "support"
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <HeartIcon className="w-4 h-4" />
            Support
          </button>
        </div>
      </div>

      {/* Tab Content */}
      
      {/* BUY TAB - Products Grid */}
      {activeTab === "buy" && (
        <div>
          {/* Producer Story (condensed) */}
          {producer.description && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-gray-700">{producer.description}</p>
            </div>
          )}
          
          {producer.products && producer.products.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {producer.products.map((product) => (
                <Link
                  key={product.id}
                  href={`/products/${product.handle}`}
                  className="group bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md hover:border-green-200 transition-all"
                >
                  <div className="relative aspect-square">
                    {product.thumbnail ? (
                      <Image
                        src={product.thumbnail}
                        alt={product.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                        <CartIcon className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-green-700 font-medium mb-1">{producer.name}</p>
                    <h4 className="font-medium text-gray-900 text-sm group-hover:text-green-700 transition-colors line-clamp-2">
                      {product.title}
                    </h4>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <CartIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No products available yet</p>
              <p className="text-sm text-gray-500 mt-1">Check back soon or subscribe to get notified</p>
            </div>
          )}
          
          {/* Harvests section (collapsed) */}
          {producer.harvests && producer.harvests.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Harvests</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {producer.harvests.slice(0, 4).map((harvest) => (
                  <div
                    key={harvest.id}
                    className="bg-green-50 rounded-lg p-3 border border-green-100"
                  >
                    <h4 className="font-medium text-gray-900 text-sm">{harvest.crop_name}</h4>
                    {harvest.variety && (
                      <p className="text-xs text-gray-500">{harvest.variety}</p>
                    )}
                    {harvest.growing_method && (
                      <span className="inline-block mt-1 text-xs bg-white text-green-700 px-2 py-0.5 rounded">
                        {harvest.growing_method}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBSCRIBE TAB - Subscription Options / Harvest Shares */}
      {activeTab === "subscribe" && (
        <div className="max-w-2xl">
          <div className="bg-blue-50 rounded-xl p-6 border border-blue-200 mb-6">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">
              Subscribe to {producer.name}
            </h2>
            <p className="text-blue-800 mb-4">
              Get regular deliveries of seasonal produce, exclusive access to harvests, 
              and support consistent income for this producer.
            </p>
          </div>

          {/* Subscription Options */}
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-lg p-4 hover:border-green-200 transition-colors cursor-pointer">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-900">Weekly Harvest Box</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Fresh seasonal selection delivered weekly
                  </p>
                </div>
                <span className="text-lg font-semibold text-gray-900">$35/week</span>
              </div>
              <button className="mt-4 w-full bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 transition-colors">
                Subscribe
              </button>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 hover:border-green-200 transition-colors cursor-pointer">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-900">Seasonal Share</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Full season commitment with savings
                  </p>
                </div>
                <span className="text-lg font-semibold text-gray-900">$400/season</span>
              </div>
              <button className="mt-4 w-full bg-white text-green-800 py-2 rounded-lg font-medium border border-green-200 hover:bg-green-50 transition-colors">
                Learn More
              </button>
            </div>
          </div>

          <p className="text-sm text-gray-500 mt-6 text-center">
            Subscriptions support stable income for producers and ensure you get the freshest food.
          </p>
        </div>
      )}

      {/* SUPPORT TAB - Direct Support / Seasonal Funding */}
      {activeTab === "support" && (
        <div className="max-w-2xl">
          <div className="bg-amber-50 rounded-xl p-6 border border-amber-200 mb-6">
            <h2 className="text-lg font-semibold text-amber-900 mb-2">
              Support {producer.name}
            </h2>
            <p className="text-amber-800 mb-4">
              Contribute directly to help with seasonal expenses, equipment, 
              or infrastructure. 100% goes to the producer.
            </p>
          </div>

          {/* Direct Support Options */}
          <div className="space-y-4 mb-8">
            <button className="w-full bg-amber-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-amber-700 transition-colors flex items-center justify-center gap-2">
              <HeartIcon className="w-5 h-5" />
              Make a Direct Contribution
            </button>
            <button className="w-full bg-white text-amber-800 py-3 px-4 rounded-lg font-medium border border-amber-300 hover:bg-amber-50 transition-colors">
              Fund a Specific Need
            </button>
          </div>

          {/* Producer Story */}
          {producer.story && (
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-3">Our Story</h3>
              <p className="text-gray-700 whitespace-pre-line">{producer.story}</p>
            </div>
          )}

          {/* Impact Tag */}
          {producer.impact_tag && (
            <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200 text-center">
              <span className="text-green-800 font-medium">{producer.impact_tag}</span>
            </div>
          )}

          {/* Gallery */}
          {producer.gallery && producer.gallery.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">From the Farm</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {producer.gallery.map((url, idx) => (
                  <div key={idx} className="relative aspect-square rounded-lg overflow-hidden">
                    <Image
                      src={url}
                      alt={`${producer.name} gallery ${idx + 1}`}
                      fill
                      className="object-cover hover:scale-105 transition-transform"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ProducerDetailPage
