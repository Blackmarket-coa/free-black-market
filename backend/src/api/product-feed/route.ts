import { createLogger } from "../../shared/logger"
const log = createLogger("api/product-feed")
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import generateProductFeedWorkflow from "../../workflows/product-feed"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const {
    currency_code,
    country_code,
  } = req.validatedQuery as { currency_code?: string; country_code?: string }

  // Default to USD and US if not provided
  const currencyCode = currency_code || "usd"
  const countryCode = country_code || "us"

  try {
    const { result } = await generateProductFeedWorkflow(req.scope).run({
      input: {
        currency_code: currencyCode,
        country_code: countryCode,
      }
    })

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8")
    res.setHeader("Cache-Control", "public, max-age=3600") // Cache for 1 hour
    res.status(200).send(result.xml)
  } catch (error) {
    log.error("Error generating product feed:", error)
    res.status(500).json({
      message: "Failed to generate product feed",
      error: error instanceof Error ? error.message : "Unknown error"
    })
  }
}
