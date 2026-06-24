import { Module } from "@medusajs/framework/utils"
import ReviewsService from "./service"

export const REVIEWS_MODULE = "reviews"

export default Module(REVIEWS_MODULE, {
  service: ReviewsService,
})

export * from "./models"
