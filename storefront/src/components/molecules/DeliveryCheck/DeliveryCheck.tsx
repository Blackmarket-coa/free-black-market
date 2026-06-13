"use client"
import { logger } from "@/lib/logger"

import { useState, useEffect, useCallback } from "react"

/**
 * Delivery availability check result
 */
export interface DeliveryCheckResult {
  available: boolean
  currently_open?: boolean
  zone?: {
    id: string
    name: string
    code: string
  }
  delivery?: {
    fee: number
    fee_formatted: string
    estimated_time: string
    distance_miles: number
    minimum_order: number
    minimum_order_formatted: string | null
  }
  service_hours?: Record<string, { open: string; close: string }>
  message?: string
  reason?: string
  suggestion?: string
}

interface DeliveryCheckProps {
  producerId?: string
  onAvailabilityChange?: (result: DeliveryCheckResult | null) => void
  className?: string
}

/**
 * DeliveryCheck Component
 * 
 * Checks if delivery is available at the customer's location
 * Uses geolocation API to get customer coordinates
 * 
 * BMC Design Philosophy:
 * - Clear, informative feedback
 * - Warm, approachable colors
 * - Non-intrusive location request
 */
export function DeliveryCheck({ 
  producerId,
  onAvailabilityChange,
  className = "",
}: DeliveryCheckProps) {
  const [result, setResult] = useState<DeliveryCheckResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationPermission, setLocationPermission] = useState<"granted" | "denied" | "prompt" | null>(null)

  // Check location permission status
  useEffect(() => {
    if ("permissions" in navigator) {
      navigator.permissions.query({ name: "geolocation" }).then((status) => {
        setLocationPermission(status.state)
        status.onchange = () => setLocationPermission(status.state)
      })
    }
  }, [])

  const checkDelivery = useCallback(async (latitude: number, longitude: number) => {
    setIsChecking(true)
    setError(null)

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/delivery-zones/check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude,
            longitude,
            producer_id: producerId,
          }),
        }
      )

      if (!response.ok) {
        throw new Error("Failed to check delivery availability")
      }

      const data: DeliveryCheckResult = await response.json()
      setResult(data)
      onAvailabilityChange?.(data)
    } catch (err) {
      logger.error("Delivery check error:", err)
      setError("Unable to check delivery availability. Please try again.")
      onAvailabilityChange?.(null)
    } finally {
      setIsChecking(false)
    }
  }, [producerId, onAvailabilityChange])

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Your browser doesn't support location services")
      return
    }

    setIsChecking(true)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        checkDelivery(position.coords.latitude, position.coords.longitude)
      },
      (err) => {
        setIsChecking(false)
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError("Location access was denied. Please enable location in your browser settings.")
            break
          case err.POSITION_UNAVAILABLE:
            setError("Unable to determine your location. Please try again.")
            break
          case err.TIMEOUT:
            setError("Location request timed out. Please try again.")
            break
          default:
            setError("Unable to get your location. Please try again.")
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000, // Cache for 5 minutes
      }
    )
  }, [checkDelivery])

  // If we haven't checked yet and don't have permission
  if (!result && !isChecking && locationPermission !== "granted") {
    return (
      <div className={`rounded-lg border p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">📍</span>
          <div className="flex-1">
            <p className="font-medium text-stone-800">
              Check if we deliver to your area
            </p>
            <p className="text-sm text-stone-500">
              Share your location to see delivery options
            </p>
          </div>
          <button
            onClick={requestLocation}
            className="px-4 py-2 bg-stone-800 text-white rounded-lg text-sm font-medium hover:bg-stone-700 transition-colors"
          >
            Check Availability
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
      </div>
    )
  }

  // Loading state
  if (isChecking) {
    return (
      <div className={`rounded-lg border border-stone-200 bg-stone-50 p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
          <span className="text-stone-600">Checking delivery availability...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !result) {
    return (
      <div className={`rounded-lg border border-red-200 bg-red-50 p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1">
            <p className="text-red-800">{error}</p>
          </div>
          <button
            onClick={requestLocation}
            className="px-3 py-1.5 text-red-700 border border-red-300 rounded-lg text-sm hover:bg-red-100 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Delivery not available
  if (result && !result.available) {
    return (
      <div className={`rounded-lg border border-orange-200 bg-orange-50 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <span className="text-xl">🚫</span>
          <div className="flex-1">
            <p className="font-medium text-orange-800">
              Delivery not available
            </p>
            <p className="text-sm text-orange-700 mt-1">
              {result.reason || "We don't currently deliver to your location."}
            </p>
            {result.suggestion && (
              <p className="text-sm text-orange-600 mt-2">
                💡 {result.suggestion}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Delivery available
  if (result?.available && result.delivery) {
    return (
      <div className={`rounded-lg border border-green-200 bg-green-50 p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <span className="text-xl">✅</span>
          <div className="flex-1">
            <p className="font-medium text-green-800">
              {result.message || "Delivery available!"}
            </p>
            
            <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-green-600">Delivery Fee</span>
                <p className="font-medium text-green-900">
                  {result.delivery.fee_formatted}
                </p>
              </div>
              <div>
                <span className="text-green-600">Est. Time</span>
                <p className="font-medium text-green-900">
                  {result.delivery.estimated_time}
                </p>
              </div>
              <div>
                <span className="text-green-600">Distance</span>
                <p className="font-medium text-green-900">
                  {result.delivery.distance_miles} mi
                </p>
              </div>
            </div>

            {result.delivery.minimum_order_formatted && (
              <p className="text-sm text-green-700 mt-3">
                📦 Minimum order: {result.delivery.minimum_order_formatted}
              </p>
            )}

            {!result.currently_open && (
              <div className="mt-3 p-2 bg-yellow-100 rounded text-sm text-yellow-800">
                ⏰ Currently closed. Delivery will be available during service hours.
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Fallback - check location button
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <button
        onClick={requestLocation}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-stone-100 text-stone-700 rounded-lg text-sm font-medium hover:bg-stone-200 transition-colors"
      >
        <span>📍</span>
        Check Delivery Availability
      </button>
    </div>
  )
}

export default DeliveryCheck
