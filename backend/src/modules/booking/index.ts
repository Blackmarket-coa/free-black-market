import { Module } from "@medusajs/framework/utils"
import BookingService from "./service"

export const BOOKING_MODULE = "booking"

export default Module(BOOKING_MODULE, {
  service: BookingService,
})

export * from "./models"
