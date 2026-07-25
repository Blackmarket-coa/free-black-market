import { defineConfig, loadEnv } from '@medusajs/framework/utils'

// Load environment variables
loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// ============================================================================
// CORS Configuration Utilities
// ============================================================================

/**
 * Parse CORS string into a Set of origins
 */
const parseCorsOrigins = (corsString: string): Set<string> => {
  const origins = new Set<string>()
  corsString.split(',').map(o => o.trim()).filter(Boolean).forEach(o => origins.add(o))
  return origins
}

/**
 * Build CORS configuration from environment variables and defaults
 */
const buildCors = (envVars: string[], defaultOrigins: string[]): string => {
  const origins = new Set<string>()

  // Add environment variable origins
  envVars.forEach(envVar => {
    const value = process.env[envVar] || ''
    parseCorsOrigins(value).forEach(o => origins.add(o))
  })

  // Add default origins
  defaultOrigins.forEach(o => origins.add(o))

  return Array.from(origins).join(',')
}

// CORS configurations
const vendorCors = buildCors(
  ['VENDOR_CORS', 'VENDOR_PANEL_URL'],
  ['https://vendor.freeblackmarket.com']
)

const storeCors = buildCors(
  ['STORE_CORS'],
  ['https://freeblackmarket.com']
)

const authCors = buildCors(
  ['AUTH_CORS', 'VENDOR_CORS', 'STORE_CORS', 'ADMIN_CORS', 'VENDOR_PANEL_URL'],
  ['https://vendor.freeblackmarket.com', 'https://freeblackmarket.com', 'https://admin.freeblackmarket.com']
)

const adminCors = buildCors(
  ['ADMIN_CORS'],
  ['https://admin.freeblackmarket.com', 'https://admin-dashboard-production-cc8f.up.railway.app']
)

// ============================================================================
// PostgreSQL Configuration Utility
// ============================================================================

/**
 * Build PostgreSQL SSL options for Railway (auto-detected)
 */
const getDatabaseDriverOptions = () => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return undefined
  const isProduction = process.env.NODE_ENV === 'production'
  // Auto-detect Railway PostgreSQL and enable SSL
  const isRailway = databaseUrl.includes('railway.app') ||
                    databaseUrl.includes('railway.internal') ||
                    databaseUrl.includes('sslmode=require') ||
                    !!process.env.RAILWAY_ENVIRONMENT

  const sslRejectUnauthorizedEnv = process.env.DB_SSL_REJECT_UNAUTHORIZED
  // Default to false for Railway (self-signed certs) and true otherwise.
  // Can always be overridden via DB_SSL_REJECT_UNAUTHORIZED env var.
  const shouldRejectUnauthorized = sslRejectUnauthorizedEnv == null
    ? !isRailway
    : sslRejectUnauthorizedEnv.toLowerCase() !== 'false'

  // Connection pool settings — applied to all environments to prevent
  // KnexTimeoutError on "SELECT 1" health-check queries.
  // pool.min=0 avoids stale-connection errors after idle periods (see
  // https://github.com/medusajs/medusa/issues/10729).
  const pool = {
    min: 0,
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    acquireTimeoutMillis: 60_000,
    createTimeoutMillis: 30_000,
    createRetryIntervalMillis: 200,
    idleTimeoutMillis: 30_000,
    reapIntervalMillis: 1_000,
  }

  if (!isRailway) {
    return { pool }
  }

  // Railway uses self-signed certs so rejectUnauthorized defaults to false there.
  // Non-Railway environments default to strict verification.
  // Override via DB_SSL_REJECT_UNAUTHORIZED env var in any environment.
  const ssl: { rejectUnauthorized: boolean; ca?: string } = {
    rejectUnauthorized: shouldRejectUnauthorized,
  }

  // Optional custom CA bundle for managed DBs that don't chain to system trust.
  if (process.env.DB_SSL_CA) {
    ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n')
  }

  return {
    connection: { ssl },
    pool,
  }
}

// ============================================================================
// Redis Configuration Utility
// ============================================================================

/**
 * Build Redis connection options with TLS support for Railway
 */
const getRedisOptions = () => {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return null

  return {
    redisUrl,
    // Enable TLS for Railway Redis (uses rediss:// protocol)
    ...(redisUrl.startsWith('rediss://') ? { tls: {} } : {}),
    // BullMQ requires maxRetriesPerRequest to be null
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 10000,
    keepAlive: 30000,
  }
}

// ============================================================================
// Module Definitions - Organized by Domain
// ============================================================================

// Core platform modules (always loaded)
const coreModules = [
  { resolve: './src/modules/seller-extension' },
  { resolve: './src/modules/tenancy' },
  { resolve: './src/modules/product-archetype' },
  { resolve: './src/modules/password-history' },
  // Composition layer (see docs/COMPOSITION_LAYER.md): playbook is the
  // cooperative-economic shape a vendor picks at setup; listing-type is
  // the orthogonal shape of each offering. Both are core to commerce
  // routing and must load before commerce/marketplace modules.
  { resolve: './src/modules/playbook' },
  { resolve: './src/modules/listing-type' },
]

// Agricultural/barn-to-door modules
const agricultureModules = [
  { resolve: './src/modules/producer' },
  { resolve: './src/modules/agriculture' },
  { resolve: './src/modules/cooperative' },
]

// Commerce feature modules
const commerceModules = [
  { resolve: './src/modules/ticket-booking' },
  { resolve: './src/modules/restaurant' },
  { resolve: './src/modules/delivery' },
  { resolve: './src/modules/digital-product' },
  { resolve: './src/modules/order-cycle' },
  { resolve: './src/modules/subscription' },
  { resolve: './src/modules/rental' },
  { resolve: './src/modules/wishlist' },
  { resolve: './src/modules/woocommerce-import' },
  { resolve: './src/modules/odoo-import' },
  // connect.js commerce embed network
  { resolve: './src/modules/embed-keys' },
  { resolve: './src/modules/booking' },
  { resolve: './src/modules/reviews' },
  { resolve: './src/modules/embed-analytics' },
  // Wellness practitioner portal (sessions, classes, memberships, CRM)
  { resolve: './src/modules/wellness' },
]

// Financial/ledger modules
const financialModules = [
  { resolve: './src/modules/hawala-ledger' },
  { resolve: './src/modules/donation' },
]

// FreeBlackMarket.com feature modules
const marketplaceModules = [
  { resolve: './src/modules/sell-signup' },
  { resolve: './src/modules/vendor-verification' },
  { resolve: './src/modules/impact-metrics' },
  { resolve: './src/modules/progression' },
  { resolve: './src/modules/collective-quest' },
  { resolve: './src/modules/vendor-quest' },
  { resolve: './src/modules/production-ledger' },
  { resolve: './src/modules/document-vault' },
  { resolve: './src/modules/nursery-vertical' },
  { resolve: './src/modules/botanical' },
  { resolve: './src/modules/payout-breakdown' },
  { resolve: './src/modules/asset-graph' },
  { resolve: './src/modules/harvest-batches' },
  { resolve: './src/modules/vendor-rules' },
  { resolve: './src/modules/supplier-forwarding' },
  { resolve: './src/modules/vendor-hype-operations-prediction' },
  { resolve: './src/modules/marketplace-listing' },
  { resolve: './src/modules/marketplace-signing' },
  { resolve: './src/modules/marketplace-webhooks' },
  { resolve: './src/modules/entitlement' },
  { resolve: './src/modules/blackstar-fulfillment' },
  { resolve: './src/modules/creator-attribution' },
  { resolve: './src/modules/creator-program' },
  { resolve: './src/modules/content-platform' },
  { resolve: './src/modules/creator-rewards' },
  { resolve: './src/modules/service-program' },
  { resolve: './src/modules/work-verification' },
  { resolve: './src/modules/order-subcontract' },
]

// Community infrastructure modules
const communityModules = [
  { resolve: './src/modules/garden' },
  { resolve: './src/modules/kitchen' },
  { resolve: './src/modules/governance' },
  { resolve: './src/modules/harvest' },
  { resolve: './src/modules/season' },
  { resolve: './src/modules/volunteer' },
  { resolve: './src/modules/food-distribution' },
]

// Collective purchasing & bargaining modules
const collectiveModules = [
  { resolve: './src/modules/demand-pool' },
  { resolve: './src/modules/bargaining' },
  { resolve: './src/modules/buyer-network' },
  { resolve: './src/modules/collective-campaign' },
]

// Phase 2 discovery layer: Opportunity Engine (§5) + Economic Intelligence
// (§15) + startup guides (§12); Product Knowledge Base / DIY library (§14);
// plugin ecosystem (§16). See PHASE_2_CHECKLIST.md.
const discoveryModules = [
  { resolve: './src/modules/opportunity-engine' },
  { resolve: './src/modules/knowledge-base' },
  { resolve: './src/modules/plugin-registry' },
]

// Content/utility modules
const utilityModules = [
  { resolve: './src/modules/cms-blueprint' },
  { resolve: './src/modules/request' },
  // First-class order-level channel attribution (roadmap Phase 3A).
  { resolve: './src/modules/order-channel' },
]

const printfulApiKey = process.env.PRINTFUL_API_KEY || process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_TOKEN

// Optional modules (conditionally loaded based on environment)
const optionalModules = [
  // Odoo ERP integration
  ...(process.env.ODOO_URL ? [{ resolve: './src/modules/odoo' }] : []),
]

// ============================================================================
// Provider Configurations
// ============================================================================

// Auth providers
//
// Slice C of the Creator Commerce roadmap. We only declare an explicit
// auth module when at least one social provider is configured via env;
// otherwise Medusa's framework default (emailpass-only) keeps applying so
// existing seller logins are unaffected.
//
// When env vars are present we declare emailpass alongside the social
// provider(s) so the seller registration flow keeps working.
const buildAuthModule = () => {
  const googleEnabled = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
  // TikTok / Discord are deferred to a follow-up PR — see
  // docs/CREATOR_COMMERCE_ROADMAP.md Phase 2 for the scope.
  if (!googleEnabled) return null

  const callbackBase = (process.env.BACKEND_URL || '').replace(/\/$/, '')

  return {
    resolve: '@medusajs/medusa/auth',
    options: {
      providers: [
        {
          resolve: '@medusajs/medusa/auth-emailpass',
          id: 'emailpass',
        },
        ...(googleEnabled
          ? [{
              resolve: '@medusajs/medusa/auth-google',
              id: 'google',
              options: {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL:
                  process.env.GOOGLE_CALLBACK_URL ||
                  (callbackBase ? `${callbackBase}/auth/seller/google/callback` : undefined),
              },
            }]
          : []),
      ],
    },
  }
}
const authModule = buildAuthModule()

// Payment providers
const paymentModule = {
  resolve: '@medusajs/medusa/payment',
  options: {
    providers: [
      {
        resolve: '@medusajs/medusa/payment-stripe',
        id: 'stripe',
        options: {
          apiKey: process.env.STRIPE_API_KEY || '',
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
        },
      },
    ],
  },
}

// Fulfillment providers
const fulfillmentModule = {
  resolve: '@medusajs/medusa/fulfillment',
  options: {
    providers: [
      { resolve: '@medusajs/medusa/fulfillment-manual', id: 'manual' },
      { resolve: './src/modules/local-delivery-fulfillment', id: 'local-delivery' },
      { resolve: './src/modules/digital-product-fulfillment', id: 'digital' },
      ...(printfulApiKey
        ? [{
            resolve: './src/modules/printful-fulfillment',
            id: 'printful',
            options: {
              api_key: printfulApiKey,
              webhook_secret: process.env.PRINTFUL_WEBHOOK_SECRET,
              store_id: process.env.PRINTFUL_STORE_ID,
            },
          }]
        : []),
      // Blackstar fulfillment provider — stub mode when integration flag is on.
      // Persists fulfillment_node_id / pickup_point_id / vending_machine_id on
      // BlackstarShipment so Blackstar can update status via webhook later.
      ...(process.env.FBM_BLACKSTAR_INTEGRATION === '1'
        ? [{
            resolve: './src/modules/blackstar-fulfillment-provider',
            id: 'blackstar',
            options: {},
          }]
        : []),
    ],
  },
}

// File storage module
const fileModule = {
  resolve: '@medusajs/medusa/file',
  options: {
    providers: [
      ...(process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY
        ? [{
            resolve: './src/modules/minio-file',
            id: 'minio',
            options: {
              endPoint: process.env.MINIO_ENDPOINT,
              port: process.env.MINIO_PORT,
              useSSL: process.env.MINIO_USE_SSL ? process.env.MINIO_USE_SSL === 'true' : undefined,
              accessKey: process.env.MINIO_ACCESS_KEY,
              secretKey: process.env.MINIO_SECRET_KEY,
              bucket: process.env.MINIO_BUCKET,
              publicUrl: process.env.MINIO_PUBLIC_URL,
            },
          }]
        : [{
            resolve: '@medusajs/medusa/file-local',
            id: 'local',
            options: {
              upload_dir: 'static',
              backend_url: `${(process.env.BACKEND_URL || process.env.RAILWAY_STATIC_URL || '').replace(/\/$/, '')}/static`,
            },
          }]),
    ],
  },
}

// Redis-based modules (event bus + workflow engine)
const redisModules = (() => {
  const redisOptions = getRedisOptions()
  if (!redisOptions) return []

  return [
    {
      resolve: '@medusajs/medusa/event-bus-redis',
      options: { redisUrl: redisOptions.redisUrl, redisOptions },
    },
    {
      resolve: '@medusajs/medusa/workflow-engine-redis',
      options: { redis: redisOptions },
    },
  ]
})()

// Notification module (Email provider - SMTP or Resend)
const notificationModules = (() => {
  if (process.env.SMTP_HOST) {
    return [{
      resolve: '@medusajs/medusa/notification',
      options: {
        providers: [{
          resolve: './src/modules/smtp',
          id: 'smtp',
          options: {
            channels: ['email'],
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
          },
        }],
      },
    }]
  }

  if (process.env.RESEND_API_KEY) {
    return [{
      resolve: '@medusajs/medusa/notification',
      options: {
        providers: [{
          resolve: './src/modules/resend',
          id: 'resend',
          options: {
            channels: ['email'],
            api_key: process.env.RESEND_API_KEY,
            from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
            retry: {
              maxAttempts: Number(process.env.RESEND_MAX_RETRIES) || 3,
              baseDelayMs: Number(process.env.RESEND_RETRY_BASE_MS) || 250,
            },
          },
        }],
      },
    }]
  }

  return []
})()

// ============================================================================
// Export Configuration
// ============================================================================


const isMedusaBuildCommand = process.argv.some(arg => arg === 'build')

// Banned placeholder literals — rejected at boot in production.
// Keep in sync with scripts/assert-env.mjs.
const BANNED_SECRET_LITERALS = new Set<string>([
  'supersecret',
  'changeme',
  'change-me',
  'change_me',
  'dev-only-secret-change-in-production-32chars',
  'test',
  'secret',
  'password',
  // docker-compose.yml dev fallback for MEDUSA_ADMIN_PASSWORD. It is 14 chars
  // (passes the length gate) and lowercase, so without this entry a prod boot
  // via `docker compose up` (where service-level `environment:` shadows the
  // .env.production file) would start with a publicly-known admin password.
  'localadmin1234',
])
// `local-dev-` covers the docker-compose.yml JWT_SECRET / COOKIE_SECRET /
// REVALIDATE_SECRET dev fallbacks (all `local-dev-*-min-32-chars-*`), which
// are >=32 chars and would otherwise satisfy the production secret checks.
const BANNED_SECRET_PREFIXES = ['CHANGE_ME', 'local-dev-']
const MIN_SECRET_LENGTH = 32

const isBannedSecret = (value: string): boolean => {
  const lower = value.trim().toLowerCase()
  if (BANNED_SECRET_LITERALS.has(lower)) return true
  return BANNED_SECRET_PREFIXES.some((p) => value.startsWith(p))
}

const getRequiredSecret = (envName: 'JWT_SECRET' | 'COOKIE_SECRET'): string => {
  const configured = process.env[envName]
  const isProduction = process.env.NODE_ENV === 'production'

  if (configured) {
    if (isProduction && !isMedusaBuildCommand) {
      if (isBannedSecret(configured)) {
        throw new Error(
          `${envName} is set to a banned placeholder value. Generate one with: ` +
          `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
        )
      }
      if (configured.length < MIN_SECRET_LENGTH) {
        throw new Error(
          `${envName} must be at least ${MIN_SECRET_LENGTH} characters in production (got ${configured.length}).`
        )
      }
    }
    return configured
  }

  if (!isProduction || isMedusaBuildCommand) {
    if (isProduction && isMedusaBuildCommand) {
      console.warn(`[medusa-config] ${envName} is not set during build; using a temporary fallback secret for build-time config loading.`)
    }
    return 'dev-only-secret-change-in-production-32chars'
  }

  throw new Error(`${envName} is required in production`)
}

// Production-only fail-closed check for the seeded admin password.
// Skipped during the medusa build step (where envs are not yet provisioned).
const assertAdminPassword = () => {
  if (process.env.NODE_ENV !== 'production' || isMedusaBuildCommand) return
  const value = process.env.MEDUSA_ADMIN_PASSWORD || ''
  if (!value) {
    throw new Error('MEDUSA_ADMIN_PASSWORD is required in production. Refusing to start with an empty admin password.')
  }
  if (isBannedSecret(value)) {
    throw new Error('MEDUSA_ADMIN_PASSWORD matches a banned placeholder literal. Refusing to start.')
  }
  if (value.length < 12) {
    throw new Error(`MEDUSA_ADMIN_PASSWORD must be at least 12 characters in production (got ${value.length}).`)
  }
}
assertAdminPassword()

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: getDatabaseDriverOptions(),
    ...(process.env.REDIS_URL ? { redisUrl: process.env.REDIS_URL } : {}),
    http: {
      storeCors,
      adminCors,
      vendorCors,
      authCors,
      jwtSecret: getRequiredSecret('JWT_SECRET'),
      cookieSecret: getRequiredSecret('COOKIE_SECRET'),
    } as any,
    // Harden the admin/vendor session cookie (connect.sid): http-only, secure in
    // production, same-site lax (admin/api share the freeblackmarket.com site so
    // first-party requests still carry it; the CSRF guard enforces same-origin on
    // writes), and an explicit 24h lifetime so sessions don't live indefinitely.
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
    sessionOptions: {
      // Align the express-session store TTL / cookie Expires with the 24h cookie.
      ttl: 24 * 60 * 60 * 1000,
    },
  },
  admin: {
    disable: true,
  },
  plugins: [
    { resolve: '@mercurjs/b2c-core', options: {} },
    { resolve: '@mercurjs/commission', options: {} },
    { resolve: '@mercurjs/reviews', options: {} },
    // @mercurjs/algolia and @mercurjs/requests removed - causing crashes
    // Algolia: Use Postgres filtering (WHERE name ILIKE) instead
    // Requests: Replaced with custom Request module at ./src/modules/request
  ],
  modules: [
    // Domain modules (organized by category)
    ...coreModules,
    ...agricultureModules,
    ...commerceModules,
    ...financialModules,
    ...marketplaceModules,
    ...communityModules,
    ...collectiveModules,
    ...discoveryModules,
    ...utilityModules,
    ...optionalModules,

    // Provider modules
    paymentModule,
    fulfillmentModule,
    fileModule,
    ...(authModule ? [authModule] : []),
    ...redisModules,
    ...notificationModules,
  ],
  // Note: Links are auto-discovered from src/links directory in MedusaJS v2
})
