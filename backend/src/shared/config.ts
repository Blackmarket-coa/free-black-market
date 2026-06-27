/**
 * Centralized Configuration Validator
 * 
 * Validates environment variables at startup with clear error messages.
 * Provides type-safe access to configuration throughout the application.
 * 
 * Build timestamp: 2026-01-03T02:05:00Z (simplify optional URL handling)
 * 
 * Usage:
 * ```typescript
 * import { config } from "../shared/config"
 * 
 * // Access validated config
 * const dbUrl = config.DATABASE_URL
 * const stellarKey = config.STELLAR_SECRET_KEY // undefined if not set
 * ```
 */
import { z } from "zod"
import { randomBytes } from "crypto"
import { createLogger } from "./logger"

const logger = createLogger("Config")
// Ephemeral, per-process development fallback for JWT_SECRET. Generated at
// startup rather than shipped as a literal so a well-known dev secret can't be
// copy-pasted into a real deployment. Production boot fails fast below if
// JWT_SECRET is unset, so this value is never used outside dev/test. It only
// ever signs/verifies self-issued tokens (e.g. checkout-session tokens) within
// the same process, so a fresh value per start is safe.
const DEV_JWT_SECRET = randomBytes(32).toString("hex")

/**
 * Helper for optional string env vars - converts empty strings to undefined
 */
const optionalString = z
  .string()
  .optional()
  .transform((val) => (val === "" || val === undefined ? undefined : val))

/**
 * Environment variable schema with validation rules
 */
const envSchema = z.object({
  // Required
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  
  // Database (required)
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  
  // Redis (optional - no URL validation since it may be empty)
  REDIS_URL: optionalString,
  
  // Server configuration
  PORT: z.string().transform(Number).default(9000),
  BACKEND_URL: optionalString,
  STOREFRONT_URL: optionalString,
  ADMIN_URL: optionalString,
  VENDOR_URL: optionalString,
  
  // Authentication
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be at least 32 characters").optional(),
  
  // Stellar blockchain (optional)
  STELLAR_SECRET_KEY: z.string().length(56, "STELLAR_SECRET_KEY must be 56 characters").optional(),
  STELLAR_NETWORK: z.enum(["testnet", "public"]).default("testnet"),
  
  // Stripe (optional)
  STRIPE_API_KEY: z.string().startsWith("sk_", "STRIPE_API_KEY must start with 'sk_'").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  
  // Matrix / Synapse (Blackout) - internal messaging (optional)
  MATRIX_HOMESERVER_URL: optionalString,
  MATRIX_PUBLIC_BASE_URL: optionalString,
  MATRIX_SERVER_NAME: optionalString,
  MATRIX_ADMIN_TOKEN: optionalString,
  MATRIX_ELEMENT_URL: optionalString,

  // Blackout integration (FreeBlackMarket <-> Blackout)
  // Outbound webhook emitter (§1-§3) + commerce API (§5) + entitlements service (§4).
  // FREEBLACKMARKET_WEBHOOK_SECRET / FREEBLACKMARKET_API_KEY are required in production
  // (enforced below in loadConfig); optional in dev/test so local boots succeed.
  FREEBLACKMARKET_WEBHOOK_SECRET: optionalString,
  FREEBLACKMARKET_API_KEY: optionalString,
  FREEBLACKMARKET_BASE_URL: optionalString,
  BLACKOUT_API_BASE: optionalString,
  ENTITLEMENTS_SERVICE_TOKEN: optionalString,
  ENTITLEMENTS_BASE_URL: optionalString,
  // Public Blackout web app origin (the user-facing app, e.g.
  // https://theblackout.app) — distinct from BLACKOUT_API_BASE which is the
  // service API. Used to build creator-facing links such as the stream overlay.
  BLACKOUT_APP_URL: optionalString,
  // HS256 signing secret for the OBS stream-overlay JWT. When unset the
  // overlay-url endpoint returns 503 (feature off) rather than minting an
  // unverifiable token.
  BLACKOUT_OVERLAY_SECRET: optionalString,

  // External services (optional - just strings, no URL validation)
  APPRISE_API_URL: optionalString,
  RESEND_API_KEY: optionalString,
  RESEND_FROM_EMAIL: optionalString,
  
  // Algolia search
  ALGOLIA_APP_ID: optionalString,
  ALGOLIA_ADMIN_KEY: optionalString,
  
  // OpenTelemetry
  OTEL_ENABLED: z.string().transform(v => v === "true").default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  OTEL_SERVICE_NAME: z.string().default("freeblackmarket-backend"),
  
  // Sentry Error Tracking
  SENTRY_DSN: optionalString,
  SENTRY_ENVIRONMENT: optionalString,
  SENTRY_RELEASE: optionalString,
  SENTRY_SAMPLE_RATE: z.string().transform(v => parseFloat(v) || 0.1).default(0.1),
  
  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  
  // Feature flags
  ENABLE_STELLAR_SETTLEMENT: z.string().transform(v => v === "true").default(false),
  ENABLE_STRIPE_ACH: z.string().transform(v => v === "true").default(false),
})

export type Config = z.infer<typeof envSchema>

/**
 * Validate and load configuration from environment variables
 */
function loadConfig(): Config {
  const result = envSchema.safeParse(process.env)
  
  if (!result.success) {
    const errors = result.error.issues.map(e => `  - ${e.path.join(".")}: ${e.message}`)
    logger.error("Configuration validation failed:\n" + errors.join("\n"))
    
    // In development, log helpful hints
    if (process.env.NODE_ENV !== "production") {
      logger.error("\n❌ Environment configuration errors found:")
      errors.forEach(e => logger.error(e))
      logger.error("\nCheck your .env file and ensure all required variables are set.\n")
    }
    
    // Don't throw in development to allow partial startup
    if (process.env.NODE_ENV === "production") {
      throw new Error("Configuration validation failed. Check logs for details.")
    }
    
    // Return partial config for development
    return result.data as unknown as Config
  }
  
  if (result.data.NODE_ENV !== "production" && !result.data.JWT_SECRET) {
    logger.warn(`JWT_SECRET not set - using default for ${result.data.NODE_ENV}`)
    result.data.JWT_SECRET = DEV_JWT_SECRET
  }

  // Production warnings
  if (result.data.NODE_ENV === "production") {
    if (!result.data.JWT_SECRET) {
      logger.error("JWT_SECRET is required in production.")
      throw new Error("JWT_SECRET is required in production.")
    }

    // COOKIE_SECRET is required in production. The authoritative Medusa boot
    // (medusa-config.ts getRequiredSecret) already refuses to start without it;
    // fail fast here too so this validator stays consistent rather than emitting
    // a misleading "using default (INSECURE)" warning for a default that the real
    // config never applies.
    if (!result.data.COOKIE_SECRET) {
      logger.error("COOKIE_SECRET is required in production.")
      throw new Error("COOKIE_SECRET is required in production.")
    }

    // Blackout integration secrets are mandatory in production: the webhook
    // emitter cannot sign deliveries and the commerce API cannot authenticate
    // Blackout without them. Fail fast rather than booting a half-wired bridge.
    if (!result.data.FREEBLACKMARKET_WEBHOOK_SECRET) {
      logger.error("FREEBLACKMARKET_WEBHOOK_SECRET is required in production.")
      throw new Error("FREEBLACKMARKET_WEBHOOK_SECRET is required in production.")
    }
    if (!result.data.FREEBLACKMARKET_API_KEY) {
      logger.error("FREEBLACKMARKET_API_KEY is required in production.")
      throw new Error("FREEBLACKMARKET_API_KEY is required in production.")
    }

    const warnings: string[] = []
    
    if (!result.data.REDIS_URL) {
      warnings.push("REDIS_URL not set - rate limiting and caching will use in-memory storage")
    }
    if (!result.data.OTEL_ENABLED) {
      warnings.push("OTEL_ENABLED=false - OpenTelemetry observability disabled")
    }
    
    warnings.forEach(w => logger.warn(w))
  }
  
  logger.info("Configuration loaded successfully", {
    environment: result.data.NODE_ENV,
    redisConfigured: !!result.data.REDIS_URL,
    stellarConfigured: !!result.data.STELLAR_SECRET_KEY,
    stripeConfigured: !!result.data.STRIPE_API_KEY,
    otelEnabled: result.data.OTEL_ENABLED,
  })
  
  return result.data
}

// Export validated configuration singleton
export const config = loadConfig()

// Helper functions for common config checks
export const isProduction = () => config.NODE_ENV === "production"
export const isDevelopment = () => config.NODE_ENV === "development"
export const isTest = () => config.NODE_ENV === "test"

// Feature flag helpers
export const features = {
  stellarSettlement: () => config.ENABLE_STELLAR_SETTLEMENT && !!config.STELLAR_SECRET_KEY,
  stripeACH: () => config.ENABLE_STRIPE_ACH && !!config.STRIPE_API_KEY,
  redis: () => !!config.REDIS_URL,
  openTelemetry: () => config.OTEL_ENABLED,
  sentry: () => !!config.SENTRY_DSN,
  matrixChat: () =>
    !!config.MATRIX_HOMESERVER_URL &&
    !!config.MATRIX_SERVER_NAME &&
    !!config.MATRIX_ADMIN_TOKEN,
  // Outbound Blackout webhook emitter is live only when we have both a signing
  // secret and a destination. Used by emitBlackout() to no-op cleanly in dev.
  freeblackmarketEmit: () =>
    !!config.FREEBLACKMARKET_WEBHOOK_SECRET && !!config.BLACKOUT_API_BASE,
}

// Export schema for testing
export { envSchema }
