import { Module } from "@medusajs/framework/utils"
import QuoteService from "./service"

export const QUOTE_MODULE = "quote"

export default Module(QUOTE_MODULE, {
  service: QuoteService,
})
