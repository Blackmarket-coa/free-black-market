import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FOOD_DISTRIBUTION_MODULE } from "../../../../modules/food-distribution"
import type FoodDistributionService from "../../../../modules/food-distribution/service"

// ===========================================
// VALIDATION SCHEMAS
// ===========================================

import { deliveryZoneCheckRequestSchema } from "../../../delivery-zones/contracts"

// ===========================================
// Haversine distance calculation
// ===========================================

function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959 // Earth's radius in miles
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

// ===========================================
// Point-in-polygon check (ray casting algorithm)
// ===========================================

function isPointInPolygon(
  lat: number,
  lng: number,
  polygon: number[][]
): boolean {
  let inside = false
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  
  return inside
}

// ===========================================
// Check if point is within a delivery zone
// ===========================================

function isWithinZone(
  customerLat: number,
  customerLng: number,
  zone: {
    center_latitude: number
    center_longitude: number
    boundary?: { type: string; coordinates: number[][][] }
  },
  maxRadius: number = 50 // Default max radius in miles
): { inZone: boolean; distance: number } {
  // Calculate distance from zone center
  const distance = calculateDistance(
    customerLat,
    customerLng,
    zone.center_latitude,
    zone.center_longitude
  )
  
  // If we have a polygon boundary, use that
  if (zone.boundary?.coordinates?.[0]) {
    const polygon = zone.boundary.coordinates[0]
    const inZone = isPointInPolygon(customerLat, customerLng, polygon)
    return { inZone, distance }
  }
  
  // Otherwise use distance check
  return { inZone: distance <= maxRadius, distance }
}

// ===========================================
// Calculate delivery fee
// ===========================================

function calculateDeliveryFee(
  distance: number,
  zone: {
    base_delivery_fee: number | bigint
    per_mile_fee: number | bigint
  }
): number {
  const baseFee = typeof zone.base_delivery_fee === 'bigint' 
    ? Number(zone.base_delivery_fee) 
    : zone.base_delivery_fee
  const perMileFee = typeof zone.per_mile_fee === 'bigint'
    ? Number(zone.per_mile_fee)
    : zone.per_mile_fee
    
  return baseFee + Math.ceil(distance) * perMileFee
}

// ===========================================
// Estimate delivery time based on distance
// ===========================================

function estimateDeliveryTime(distance: number): string {
  // Base preparation time + travel time
  const prepTime = 15 // minutes
  const travelTimePerMile = 3 // minutes per mile (accounts for traffic, stops)
  const totalMinutes = prepTime + Math.ceil(distance * travelTimePerMile)
  
  // Round to nice ranges
  if (totalMinutes <= 30) return "20-30 min"
  if (totalMinutes <= 45) return "30-45 min"
  if (totalMinutes <= 60) return "45-60 min"
  if (totalMinutes <= 90) return "60-90 min"
  return `${Math.floor(totalMinutes / 60)}-${Math.ceil(totalMinutes / 60) + 1} hours`
}

// ===========================================
// Check if currently within service hours
// ===========================================

function isWithinServiceHours(
  serviceHours: Record<string, { open: string; close: string }> | null
): boolean {
  if (!serviceHours) return true // No hours specified = always available
  
  const now = new Date()
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  const today = days[now.getDay()]
  
  const todayHours = serviceHours[today]
  if (!todayHours) return false // Closed today
  
  const currentTime = now.toTimeString().slice(0, 5) // "HH:MM"
  return currentTime >= todayHours.open && currentTime <= todayHours.close
}

// ===========================================
// POST /store/delivery-zones/check
// Check if delivery is available at customer location
// ===========================================

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const data = deliveryZoneCheckRequestSchema.parse(req.body)
    const foodDistribution = req.scope.resolve<FoodDistributionService>(FOOD_DISTRIBUTION_MODULE)
    
    // Get all active delivery zones
    const zones = await foodDistribution.listDeliveryZones({ active: true }, {
      order: { priority: "DESC" },
    })
    
    if (!zones.length) {
      res.json({
        available: false,
        code: "DELIVERY_ZONES_UNAVAILABLE",
        reason: "No delivery zones are currently configured",
      })
      return
    }
    
    // Find matching zones
    const matchingZones: Array<{
      zone: typeof zones[0]
      distance: number
      fee: number
      estimatedTime: string
      isOpen: boolean
    }> = []
    
    for (const zone of zones) {
      // Cast zone boundary to expected type
      const zoneWithBoundary = {
        ...zone,
        boundary: zone.boundary as { type: string; coordinates: number[][][] } | undefined
      }
      
      const { inZone, distance } = isWithinZone(
        data.latitude,
        data.longitude,
        zoneWithBoundary
      )
      
      if (inZone) {
        const fee = calculateDeliveryFee(distance, zone)
        const estimatedTime = estimateDeliveryTime(distance)
        const isOpen = isWithinServiceHours(zone.service_hours as Record<string, { open: string; close: string }> | null)
        
        matchingZones.push({
          zone,
          distance,
          fee,
          estimatedTime,
          isOpen,
        })
      }
    }
    
    if (!matchingZones.length) {
      res.json({
        available: false,
        code: "DELIVERY_NOT_AVAILABLE",
        reason: "Outside delivery area. We don't currently deliver to your location.",
        suggestion: "You may be able to order for pickup instead.",
        next_action: "switch_to_pickup",
      })
      return
    }
    
    // Get the best matching zone (highest priority, currently open)
    const openZones = matchingZones.filter(m => m.isOpen)
    const bestMatch = openZones.length > 0 ? openZones[0] : matchingZones[0]
    
    // Check minimum order requirement
    const minimumOrder = bestMatch.zone.minimum_order
      ? typeof bestMatch.zone.minimum_order === 'bigint'
        ? Number(bestMatch.zone.minimum_order)
        : bestMatch.zone.minimum_order
      : 0
    
    res.json({
      available: true,
      code: bestMatch.isOpen ? "DELIVERY_AVAILABLE" : "DELIVERY_ZONE_CLOSED",
      currently_open: bestMatch.isOpen,
      zone: {
        id: bestMatch.zone.id,
        name: bestMatch.zone.name,
        code: bestMatch.zone.code,
      },
      delivery: {
        fee: bestMatch.fee, // In cents
        fee_formatted: `$${(bestMatch.fee / 100).toFixed(2)}`,
        estimated_time: bestMatch.estimatedTime,
        distance_miles: Math.round(bestMatch.distance * 10) / 10,
        minimum_order: minimumOrder, // In cents
        minimum_order_formatted: minimumOrder > 0 ? `$${(minimumOrder / 100).toFixed(2)}` : null,
      },
      // If not currently open, show when service resumes
      service_hours: bestMatch.zone.service_hours,
      message: bestMatch.isOpen 
        ? `Delivery available! Estimated ${bestMatch.estimatedTime}`
        : "Delivery zone found but currently closed. Check service hours.",
      next_action: bestMatch.isOpen ? "continue_checkout" : "schedule_or_pickup",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Validation failed", errors: error.errors })
      return
    }
    throw error
  }
}
