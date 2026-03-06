import { Module } from "@medusajs/framework/utils"
import VendorHypeOperationsPredictionService from "./service"

export const VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE = "vendorHypeOperationsPrediction"

export default Module(VENDOR_HYPE_OPERATIONS_PREDICTION_MODULE, {
  service: VendorHypeOperationsPredictionService,
})

export * from "./models"

export * from "./policy-service"
