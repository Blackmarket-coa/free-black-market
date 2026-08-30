import { MedusaService } from "@medusajs/framework/utils"
import { distanceMiles } from "../../lib/geo-distance"
import {
  FoodProducer,
  FoodProducerAdmin,
  Courier,
  CourierShift,
  FoodOrder,
  FoodOrderItem,
  FoodDelivery,
  DeliveryEvent,
  DeliveryBatch,
  DeliveryZone,
} from "./models"
import { CourierStatus } from "./models/courier"
import { OperatingStatus } from "./models/food-producer"
import { DeliveryStatus } from "./models/delivery"

/**
 * FoodDistributionService
 * 
 * Core service for managing food distribution operations including:
 * - All producer types (restaurants, cottage food, food banks, mutual aid, etc.)
 * - Courier management (employees, volunteers, independent contractors)
 * - Order processing (sales, trades, donations)
 * - Delivery tracking with real-time GPS
 * 
 * This service supports the solidarity economy approach where food can be:
 * - Sold (commercial transactions)
 * - Traded (barter/exchange)
 * - Donated (charitable giving)
 * - Shared (community distribution)
 * - Rescued (food waste reduction)
 */
class FoodDistributionService extends MedusaService({
  FoodProducer,
  FoodProducerAdmin,
  Courier,
  CourierShift,
  FoodOrder,
  FoodOrderItem,
  FoodDelivery,
  DeliveryEvent,
  DeliveryBatch,
  DeliveryZone,
}) {
  
  // ===========================================
  // PRODUCER MANAGEMENT
  // ===========================================
  
  /**
   * Get active producers by type
   */
  async getProducersByType(type: string, options?: { take?: number; skip?: number }) {
    return this.listFoodProducers(
      { producer_type: type, operating_status: OperatingStatus.ACCEPTING_ORDERS },
      options
    )
  }
  
  /**
   * Get producers accepting donations
   */
  async getDonationAcceptingProducers() {
    return this.listFoodProducers({
      accepts_donations: true,
      operating_status: OperatingStatus.ACCEPTING_ORDERS,
    })
  }
  
  /**
   * Get producers accepting trades
   */
  async getTradeEnabledProducers() {
    return this.listFoodProducers({
      accepts_trades: true,
      operating_status: OperatingStatus.ACCEPTING_ORDERS,
    })
  }
  
  /**
   * Check if producer is currently open
   */
  async isProducerOpen(producerId: string): Promise<boolean> {
    const producer = await this.retrieveFoodProducer(producerId)
    if (!producer || producer.operating_status !== OperatingStatus.ACCEPTING_ORDERS) return false
    
    const now = new Date()
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
    const currentTime = now.toTimeString().substring(0, 5) // HH:MM
    
    const hours = producer.operating_hours as Record<string, { open: string; close: string }>
    if (!hours || !hours[dayOfWeek]) return false
    
    const { open, close } = hours[dayOfWeek]
    return currentTime >= open && currentTime <= close
  }
  
  // ===========================================
  // COURIER MANAGEMENT
  // ===========================================
  
  /**
   * Get available couriers in a zone
   */
  async getAvailableCouriers(zoneCode?: string) {
    return this.listCouriers({
      status: CourierStatus.AVAILABLE,
      ...(zoneCode && { service_area: { $contains: zoneCode } }),
    })
  }
  
  /**
   * Update courier location
   */
  async updateCourierLocation(
    courierId: string,
    latitude: number,
    longitude: number
  ) {
    return this.updateCouriers({
      id: courierId,
      current_latitude: latitude,
      current_longitude: longitude,
      location_updated_at: new Date(),
    })
  }
  
  /**
   * Start courier shift
   */
  async startCourierShift(courierId: string, shiftId?: string) {
    if (shiftId) {
      await this.updateCourierShifts({
        id: shiftId,
        actual_start: new Date(),
      })
    }
    
    return this.updateCouriers({ id: courierId, status: CourierStatus.AVAILABLE })
  }
  
  /**
   * End courier shift
   */
  async endCourierShift(courierId: string, shiftId?: string) {
    if (shiftId) {
      await this.updateCourierShifts({
        id: shiftId,
        actual_end: new Date(),
      })
    }
    
    return this.updateCouriers({ id: courierId, status: CourierStatus.OFFLINE })
  }
  
  // ===========================================
  // ORDER MANAGEMENT
  // ===========================================
  
  /**
   * Create a food order with items
   */
  async createFoodOrderWithItems(
    orderData: Record<string, any>,
    items: Array<Record<string, any>>
  ) {
    // Generate order number
    const orderNumber = `FO-${Date.now().toString(36).toUpperCase()}`
    
    const order = await this.createFoodOrders({
      ...orderData,
      order_number: orderNumber,
      ordered_at: new Date(),
    })
    
    // Create items
    const createdItems = await Promise.all(
      items.map((item) =>
        this.createFoodOrderItems({
          ...item,
          order: order.id,
        })
      )
    )
    
    return { order, items: createdItems }
  }
  
  /**
   * Get orders for a producer
   */
  async getProducerOrders(
    producerId: string,
    status?: string,
    options?: { take?: number; skip?: number }
  ) {
    return this.listFoodOrders(
      {
        producer_id: producerId,
        ...(status && { status }),
      },
      options
    )
  }
  
  /**
   * Get donation orders
   */
  async getDonationOrders(producerId?: string) {
    return this.listFoodOrders({
      transaction_type: "DONATION",
      ...(producerId && { producer_id: producerId }),
    })
  }
  
  /**
   * Get trade offers
   */
  async getTradeOffers(producerId: string) {
    return this.listFoodOrders({
      transaction_type: "TRADE",
      producer_id: producerId,
      status: "PENDING",
    })
  }
  
  // ===========================================
  // DELIVERY MANAGEMENT
  // ===========================================
  
  /**
   * Create delivery for an order
   */
  async createDeliveryForOrder(orderId: string, deliveryData: Record<string, any>) {
    const order = await this.retrieveFoodOrder(orderId)
    if (!order) throw new Error("Order not found")
    
    const deliveryNumber = `DEL-${Date.now().toString(36).toUpperCase()}`
    
    const delivery = await this.createFoodDeliveries({
      ...deliveryData,
      order_id: orderId,
      producer_id: order.producer_id,
      delivery_number: deliveryNumber,
      status_history: { entries: [{ status: DeliveryStatus.PENDING, timestamp: new Date().toISOString() }] },
    } as any)
    
    // Log event
    await this.logDeliveryEvent(delivery.id, {
      event_type: "created",
      new_status: "PENDING",
      description: "Delivery created",
    })
    
    return delivery
  }
  
  /**
   * Assign courier to delivery
   */
  async assignCourierToDelivery(deliveryId: string, courierId: string) {
    // Update courier status
    await this.updateCouriers({ id: courierId, status: CourierStatus.ON_DELIVERY })
    
    // Update delivery
    const delivery = await this.updateFoodDeliveries({
      id: deliveryId,
      courier_id: courierId,
      status: DeliveryStatus.ASSIGNED,
      assigned_at: new Date(),
    })
    
    // Log event
    await this.logDeliveryEvent(deliveryId, {
      event_type: "status_change",
      previous_status: "PENDING",
      new_status: "ASSIGNED",
      actor_type: "SYSTEM",
      description: `Courier assigned`,
    })
    
    return delivery
  }
  
  /**
   * Update delivery status with location
   */
  async updateDeliveryStatus(
    deliveryId: string,
    status: DeliveryStatus,
    location?: { latitude: number; longitude: number },
    notes?: string
  ) {
    const delivery = await this.retrieveFoodDelivery(deliveryId)
    if (!delivery) throw new Error("Delivery not found")
    
    // Parse existing status history
    const existingHistory = delivery.status_history as { entries?: any[] } | null
    const statusEntries = existingHistory?.entries || []
    statusEntries.push({
      status,
      timestamp: new Date().toISOString(),
      ...(location && { location }),
      ...(notes && { note: notes }),
    })
    
    const updateData: Record<string, any> = {
      id: deliveryId,
      status,
      status_history: { entries: statusEntries },
    }
    
    // Update timestamps based on status
    if (status === DeliveryStatus.COURIER_EN_ROUTE_PICKUP) {
      updateData.courier_departed_for_pickup_at = new Date()
    } else if (status === DeliveryStatus.COURIER_ARRIVED_PICKUP) {
      updateData.courier_arrived_at_pickup_at = new Date()
    } else if (status === DeliveryStatus.ORDER_PICKED_UP) {
      updateData.picked_up_at = new Date()
    } else if (status === DeliveryStatus.EN_ROUTE_DELIVERY) {
      updateData.departed_for_delivery_at = new Date()
    } else if (status === DeliveryStatus.ARRIVED_AT_DESTINATION) {
      updateData.arrived_at_delivery_at = new Date()
    } else if (status === DeliveryStatus.DELIVERED || 
               status === DeliveryStatus.DELIVERED_TO_NEIGHBOR || 
               status === DeliveryStatus.DELIVERED_TO_SAFE_PLACE) {
      updateData.delivered_at = new Date()
    }
    
    // Update location if provided
    if (location) {
      updateData.last_known_latitude = location.latitude
      updateData.last_known_longitude = location.longitude
    }
    
    const updated = await this.updateFoodDeliveries(updateData)
    
    // Log event
    await this.logDeliveryEvent(deliveryId, {
      event_type: "status_change",
      previous_status: delivery.status,
      new_status: status,
      ...(location && {
        latitude: location.latitude,
        longitude: location.longitude,
      }),
      description: notes || `Status changed to ${status}`,
    })
    
    return updated
  }
  
  /**
   * Record proof of delivery
   */
  async recordProofOfDelivery(
    deliveryId: string,
    proofType: string,
    proofData: {
      photoUrl?: string
      signatureUrl?: string
      pinCode?: string
      recipientName?: string
      notes?: string
    }
  ) {
    const delivery = await this.updateFoodDeliveries({
      id: deliveryId,
      proof_type: proofType as any,
      proof_photo_url: proofData.photoUrl,
      proof_signature_url: proofData.signatureUrl,
      proof_pin_code: proofData.pinCode,
      proof_recipient_name: proofData.recipientName,
      proof_notes: proofData.notes,
      status: DeliveryStatus.DELIVERED,
      delivered_at: new Date(),
    })
    
    // Log event
    await this.logDeliveryEvent(deliveryId, {
      event_type: "proof_of_delivery",
      new_status: DeliveryStatus.DELIVERED,
      description: `Delivery completed with ${proofType} proof`,
    })
    
    // Free up courier
    if (delivery.courier_id) {
      await this.updateCouriers({ id: delivery.courier_id, status: CourierStatus.AVAILABLE })
    }
    
    return delivery
  }
  
  /**
   * Log a delivery event
   */
  async logDeliveryEvent(
    deliveryId: string,
    eventData: {
      event_type: string
      previous_status?: string | DeliveryStatus
      new_status?: string | DeliveryStatus
      latitude?: number
      longitude?: number
      actor_type?: "COURIER" | "CUSTOMER" | "PRODUCER" | "ADMIN" | "SYSTEM"
      actor_id?: string
      description?: string
      metadata?: Record<string, any>
    }
  ) {
    return this.createDeliveryEvents({
      ...eventData,
      delivery: deliveryId,
      occurred_at: new Date(),
    })
  }
  
  /**
   * Track courier location (add to route)
   */
  async trackCourierLocation(
    deliveryId: string,
    latitude: number,
    longitude: number,
    speed?: number,
    heading?: number
  ) {
    const delivery = await this.retrieveFoodDelivery(deliveryId)
    if (!delivery) throw new Error("Delivery not found")
    
    // Parse existing route tracking
    const existingRoutes = delivery.route_tracking as { points?: any[] } | null
    const routePoints = existingRoutes?.points || []
    routePoints.push({
      lat: latitude,
      lng: longitude,
      timestamp: new Date().toISOString(),
      ...(speed && { speed }),
      ...(heading && { heading }),
    })
    
    return this.updateFoodDeliveries({
      id: deliveryId,
      route_tracking: { points: routePoints },
      last_known_latitude: latitude,
      last_known_longitude: longitude,
    })
  }
  
  // ===========================================
  // BATCH DELIVERIES
  // ===========================================
  
  /**
   * Create a batch of deliveries
   */
  async createDeliveryBatch(
    deliveryIds: string[],
    courierId?: string,
    isCommunityRun?: boolean,
    communityOrgId?: string,
    owner?: { id?: string | null; type?: string | null }
  ) {
    const batchNumber = `BATCH-${Date.now().toString(36).toUpperCase()}`

    // Batch status type-safe assignment
    const batchStatus: "PLANNING" | "ASSIGNED" = courierId ? "ASSIGNED" : "PLANNING"

    const batch = await this.createDeliveryBatches({
      batch_number: batchNumber,
      courier_id: courierId,
      status: batchStatus,
      total_deliveries: deliveryIds.length,
      is_community_run: isCommunityRun || false,
      community_org_id: communityOrgId,
      owner_id: owner?.id ?? null,
      owner_type: owner?.type ?? null,
    } as any)
    
    // Update all deliveries
    await Promise.all(
      deliveryIds.map((id, index) =>
        this.updateFoodDeliveries({
          id,
          batch_id: batch.id,
          batch_sequence: index + 1,
        })
      )
    )
    
    return batch
  }
  
  // ===========================================
  // DELIVERY ZONES
  // ===========================================
  
  /**
   * Find delivery zone by coordinates
   */
  async findDeliveryZone(latitude: number, longitude: number) {
    // This would ideally use PostGIS for proper point-in-polygon queries
    // For now, return zones sorted by distance from center
    const zones = await this.listDeliveryZones({ active: true })
    
    // Calculate distances and sort
    const zonesWithDistance = zones.map((zone) => {
      const dist = this.calculateDistance(
        latitude,
        longitude,
        zone.center_latitude,
        zone.center_longitude
      )
      return { ...zone, distance: dist }
    })
    
    zonesWithDistance.sort((a, b) => a.distance - b.distance)
    return zonesWithDistance[0] || null
  }
  
  /**
   * Calculate delivery fee for a zone
   */
  async calculateDeliveryFee(
    zoneId: string,
    distanceMiles: number
  ): Promise<number> {
    const zone = await this.retrieveDeliveryZone(zoneId)
    if (!zone) return 0
    
    const baseFee = Number(zone.base_delivery_fee) || 0
    const perMileFee = Number(zone.per_mile_fee) || 0
    
    return baseFee + (distanceMiles * perMileFee)
  }
  
  // ===========================================
  // UTILITY METHODS
  // ===========================================
  
  /**
   * Calculate distance between two points (Haversine formula)
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    // Delegates to the consolidated implementation (W5).
    return distanceMiles(lat1, lon1, lat2, lon2)
  }
  
  /**
   * Calculate ETA based on distance
   */
  calculateETA(distanceMiles: number, avgSpeedMph: number = 25): Date {
    const durationMinutes = (distanceMiles / avgSpeedMph) * 60
    const eta = new Date()
    eta.setMinutes(eta.getMinutes() + durationMinutes)
    return eta
  }
}

export default FoodDistributionService
