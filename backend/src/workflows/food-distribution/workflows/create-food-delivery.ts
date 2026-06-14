import {
  WorkflowResponse,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"
import { createFoodDeliveryStep } from "../steps/create-food-delivery"

type CreateFoodDeliveryWorkflowInput = {
  order_id: string
  producer_id: string
  pickup_address: string
  pickup_latitude?: number
  pickup_longitude?: number
  pickup_instructions?: string
  pickup_contact_name?: string
  pickup_contact_phone?: string
  delivery_address: string
  delivery_latitude?: number
  delivery_longitude?: number
  delivery_instructions?: string
  recipient_name: string
  recipient_phone?: string
  contactless_delivery?: boolean
  leave_at_door?: boolean
  safe_place_description?: string
  requires_hot?: boolean
  requires_cold?: boolean
  priority?: string
}

export const createFoodDeliveryWorkflowId = "create-food-delivery-workflow"
export const createFoodDeliveryWorkflow = createWorkflow(
  createFoodDeliveryWorkflowId,
  function (input: CreateFoodDeliveryWorkflowInput) {
    const delivery = createFoodDeliveryStep({
      order_id: input.order_id,
      pickup_address: input.pickup_address,
      pickup_latitude: input.pickup_latitude,
      pickup_longitude: input.pickup_longitude,
      pickup_instructions: input.pickup_instructions,
      pickup_contact_name: input.pickup_contact_name,
      pickup_contact_phone: input.pickup_contact_phone,
      delivery_address: input.delivery_address,
      delivery_latitude: input.delivery_latitude,
      delivery_longitude: input.delivery_longitude,
      delivery_instructions: input.delivery_instructions,
      recipient_name: input.recipient_name,
      recipient_phone: input.recipient_phone,
      contactless_delivery: input.contactless_delivery,
      leave_at_door: input.leave_at_door,
      safe_place_description: input.safe_place_description,
      requires_hot: input.requires_hot,
      requires_cold: input.requires_cold,
      priority: input.priority,
    })

    return new WorkflowResponse(delivery)
  }
)
