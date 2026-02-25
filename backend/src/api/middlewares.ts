import {
  defineMiddlewares,
  authenticate,
  validateAndTransformQuery,
  validateAndTransformBody,
} from "@medusajs/framework/http";
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http";
import { parseCorsOrigins } from "@medusajs/framework/utils";
import cors from "cors";
import { z } from "zod";
import {
  authRateLimiter,
  authSessionRateLimiter,
  strictAuthRateLimiter,
  vendorRegistrationRateLimiter,
} from "../shared/rate-limiter";
import { preventPasswordReuseMiddleware } from "./middlewares/password-history";
import { ensureSellerContext } from "./vendor/_middlewares";
import { CreateVenueSchema } from "./admin/venues/route";
import { CreateTicketProductSchema } from "./admin/ticket-products/route";
import { GetTicketProductSeatsSchema } from "./store/ticket-products/[id]/seats/route";
import { requireFeatureFlagMiddleware } from "../shared/runtime-module-gates";
import {
  inventoryLedgerEventSchema,
  invoiceSchema,
  pickPackBatchSchema,
  weightPriceRuleSchema,
} from "../shared/phase0-contracts";

// Basic email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Allow vendor profile updates to include extension settings fields.
 *
 * We intentionally use `.passthrough()` so existing seller update fields
 * keep working while accepting custom keys like `enabled_extensions`.
 */
const PostVendorSellersMeBodySchema = z
  .object({
    enabled_extensions: z.array(z.string()).nullable().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .passthrough();

const PostVendorSellerExtensionsBodySchema = z.object({
  enabled_extensions: z.array(z.string()).nullable(),
});

const PostVendorHermesRuntimeBodySchema = z.object({
  tool_call: z.object({
    action: z.string().min(1),
    parameters: z.record(z.unknown()),
  }),
  confirmation: z
    .object({
      explicitIntentInCurrentThread: z.boolean().optional(),
      impactSummarized: z.boolean().optional(),
      explicitConfirmationTurn: z.boolean().optional(),
      scopeChangedAfterConfirmation: z.boolean().optional(),
      reconfirmedAfterScopeChange: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Middleware: Normalize and Validate Email
 *
 * Ensures email signups and logins are case-insensitive by normalizing
 * the email field to lowercase before processing. Also validates email format.
 */
async function normalizeEmailMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  if (req.body && typeof req.body === "object") {
    const body = req.body as Record<string, unknown>;

    // Normalize and validate email field
    if (body.email && typeof body.email === "string") {
      const normalizedEmail = body.email.toLowerCase().trim();

      // Validate email format
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({
          message: "Invalid email format",
          type: "invalid_data",
        });
      }

      body.email = normalizedEmail;
    }

    // Also handle identifier field (used in password reset)
    if (body.identifier && typeof body.identifier === "string") {
      body.identifier = body.identifier.toLowerCase().trim();
    }
  }

  next();
}

/**
 * Middleware: Validate password field type
 *
 * Ensures password is a string when provided to auth endpoints.
 */
async function validatePasswordMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  if (req.body && typeof req.body === "object") {
    const body = req.body as Record<string, unknown>;

    if (body.password !== undefined && typeof body.password !== "string") {
      return res.status(400).json({
        message: "Password should be a string",
        type: "invalid_data",
      });
    }
  }

  next();
}

/**
 * Middleware: Strip unsupported 'q' query parameter
 *
 * Some MercurJS/Medusa endpoints don't support the 'q' search parameter.
 * The admin panel's global search sends 'q' to many endpoints, causing
 * "Unrecognized fields: 'q'" validation errors or "Trying to query by not
 * existing property LinkModel.q" database errors. This middleware strips
 * the 'q' parameter from routes that don't support it.
 */
async function stripQueryParamMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  // Strip 'q' from query params if present
  if (req.query && typeof req.query === "object" && "q" in req.query) {
    delete (req.query as Record<string, unknown>).q;
  }
  next();
}

/**
 * Routes that support the 'q' search parameter.
 * All other routes should have 'q' stripped to prevent validation errors.
 */
const routesSupportingSearch = new Set([
  // Medusa core admin routes that support search
  "/admin/products",
  "/admin/orders",
  "/admin/customers",
  "/admin/draft-orders",
  "/admin/users",
  "/admin/gift-cards",
  "/admin/discounts",
  "/admin/promotions",
  "/admin/return-reasons",
  // MercurJS vendor routes that support search
  "/vendor/products",
  "/vendor/orders",
  // Store routes that support search
  "/store/products",
  "/store/collections",
]);

/**
 * Check if a route path supports the 'q' search parameter
 */
function routeSupportsSearch(path: string): boolean {
  // Normalize path
  const normalizedPath = path.split("?")[0].replace(/\/$/, "");

  // Check exact matches and prefix matches
  for (const route of routesSupportingSearch) {
    if (normalizedPath === route || normalizedPath.startsWith(route + "/")) {
      return true;
    }
  }
  return false;
}

/**
 * Global middleware to strip 'q' from admin routes that don't support search.
 * This is more comprehensive than listing individual routes.
 */
async function stripQueryParamForAdminMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  // Only process GET requests
  if (req.method !== "GET") {
    return next();
  }

  // Only process if 'q' is present
  if (!req.query || typeof req.query !== "object" || !("q" in req.query)) {
    return next();
  }

  // Check if this route supports search
  if (!routeSupportsSearch(req.path)) {
    delete (req.query as Record<string, unknown>).q;
  }

  next();
}

// Product feed query validation schema
const productFeedQuerySchema = z.object({
  currency_code: z.string().length(3).optional().default("usd"),
  country_code: z.string().min(2).max(3).optional().default("us"),
});

// Rental configuration body schema
const PostRentalConfigBodySchema = z.object({
  min_rental_days: z.number().optional(),
  max_rental_days: z.number().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

// Rental status body schema
const PostRentalStatusBodySchema = z.object({
  status: z.enum(["active", "returned", "cancelled"]),
});

// Rental availability query schema
const GetRentalAvailabilitySchema = z.object({
  variant_id: z.string(),
  start_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "start_date must be a valid date string (YYYY-MM-DD)",
  }),
  end_date: z
    .string()
    .optional()
    .refine((val) => val === undefined || !isNaN(Date.parse(val)), {
      message: "end_date must be a valid date string (YYYY-MM-DD)",
    }),
  currency_code: z.string().optional(),
});

// Cart rental items body schema
const PostCartItemsRentalsBody = z.object({
  variant_id: z.string(),
  quantity: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const PostInventorySyncEventBody = inventoryLedgerEventSchema;
const PostWeightPricingRuleBody = weightPriceRuleSchema;
const PostPickPackBatchBody = pickPackBatchSchema;
const PostInvoiceBody = invoiceSchema;

/**
 * Build CORS origins string from environment variables
 * Combines VENDOR_CORS, STORE_CORS, AUTH_CORS, ADMIN_CORS, and VENDOR_PANEL_URL
 */
function getVendorCorsOrigins(): string {
  const origins = new Set<string>();

  // Add origins from all CORS environment variables
  const envVars = ["VENDOR_CORS", "STORE_CORS", "AUTH_CORS", "ADMIN_CORS"];
  for (const envVar of envVars) {
    const value = process.env[envVar] || "";
    value
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => origins.add(o));
  }

  // Add vendor panel URL
  if (process.env.VENDOR_PANEL_URL?.trim()) {
    origins.add(process.env.VENDOR_PANEL_URL.trim());
  }

  // Production origins should be configured via VENDOR_CORS, STORE_CORS,
  // ADMIN_CORS, and AUTH_CORS environment variables rather than hardcoded.

  return Array.from(origins).join(",");
}

/**
 * Vendor CORS Middleware
 * Uses the official cors package with parseCorsOrigins for proper CORS handling
 * This handles preflight OPTIONS requests correctly
 */
function vendorCorsMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const origin = req.headers.origin || "";

  // Get CORS origins
  const corsOrigins = getVendorCorsOrigins();

  // Custom origin function to also allow Railway preview deployments
  const customOriginHandler = (
    reqOrigin: string | undefined,
    callback: (err: Error | null, origin?: boolean | string) => void,
  ) => {
    if (!reqOrigin) {
      // Allow requests with no origin (like mobile apps or curl)
      callback(null, true);
      return;
    }

    // Parse configured origins
    const allowedOrigins = parseCorsOrigins(corsOrigins);

    // Check if origin is in the allowed list
    if (
      allowedOrigins.includes(reqOrigin) ||
      allowedOrigins.includes(reqOrigin.replace(/\/$/, ""))
    ) {
      callback(null, true);
      return;
    }

    // Check for known subdomains only (not wildcard)
    try {
      const originUrl = new URL(reqOrigin);
      const hostname = originUrl.hostname.toLowerCase();
      const allowedSubdomains = [
        "vendor.freeblackmarket.com",
        "admin.freeblackmarket.com",
        "freeblackmarket.com",
        "api.freeblackmarket.com",
      ];

      if (allowedSubdomains.includes(hostname)) {
        callback(null, true);
        return;
      }

      // Allow Railway preview deployments in non-production only
      if (
        process.env.NODE_ENV !== "production" &&
        hostname.endsWith(".up.railway.app")
      ) {
        callback(null, true);
        return;
      }
    } catch (e) {
      // Invalid URL, continue to rejection
    }

    console.warn(`[VENDOR CORS] Origin not allowed: ${reqOrigin}`);
    callback(null, false);
  };

  // Apply the cors middleware
  return cors({
    origin: customOriginHandler,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Publishable-API-Key",
      "x-publishable-api-key",
      "X-Medusa-Access-Token",
      "Cookie",
    ],
    maxAge: 86400,
  })(req, res, next);
}

/**
 * Admin CORS Middleware
 * Handles CORS for custom /admin/* routes that aren't handled by Medusa core
 */
function adminCorsMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const origin = req.headers.origin || "";

  // Custom origin function to allow admin dashboards and Railway
  const customOriginHandler = (
    reqOrigin: string | undefined,
    callback: (err: Error | null, origin?: boolean | string) => void,
  ) => {
    if (!reqOrigin) {
      callback(null, true);
      return;
    }

    // Check ADMIN_CORS env var (production origins should be set here)
    const envAdminCors = process.env.ADMIN_CORS || "";
    const envOrigins = envAdminCors
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (envOrigins.includes(reqOrigin)) {
      callback(null, true);
      return;
    }

    // Check for known subdomains only (not wildcard)
    try {
      const originUrl = new URL(reqOrigin);
      const hostname = originUrl.hostname.toLowerCase();
      const allowedSubdomains = [
        "admin.freeblackmarket.com",
        "freeblackmarket.com",
      ];

      if (allowedSubdomains.includes(hostname)) {
        callback(null, true);
        return;
      }

      // Allow Railway preview deployments in non-production only
      if (
        process.env.NODE_ENV !== "production" &&
        hostname.endsWith(".up.railway.app")
      ) {
        callback(null, true);
        return;
      }
    } catch (e) {
      // Invalid URL
    }

    callback(null, false);
  };

  return cors({
    origin: customOriginHandler,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Publishable-API-Key",
      "x-publishable-api-key",
      "X-Medusa-Access-Token",
      "Cookie",
    ],
    maxAge: 86400,
  })(req, res, next);
}

/**
 * Security Headers Middleware
 * Applies security headers to all routes
 */
async function securityHeadersMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const isVendorRoute = req.path?.startsWith("/vendor") || false;
  const isProduction = process.env.NODE_ENV === "production";

  // Relaxed CSP for vendor routes (allow unsafe-eval for development tools)
  if (isVendorRoute) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' https: data:; connect-src 'self' https: wss:; frame-src 'self' https:; object-src 'none'",
    );
  } else {
    // Standard strict CSP for other routes
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' https: data:; connect-src 'self' https://api.stripe.com https://*.algolia.net https://*.algolianet.com wss:; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; object-src 'none'; upgrade-insecure-requests",
    );
  }

  // HSTS (only in production)
  if (isProduction) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  // Other security headers
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self)",
  );
  res.setHeader("X-DNS-Prefetch-Control", "off");

  // Disable caching for admin/vendor routes
  if (req.path?.startsWith("/admin") || isVendorRoute) {
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
}

export default defineMiddlewares({
  routes: [
    // ============================================================
    // GLOBAL: Strip 'q' parameter from all admin routes
    // ============================================================
    // The admin panel's global search sends 'q' to ALL endpoints, but most
    // don't support it, causing "Unrecognized fields: 'q'" validation errors
    // or "Trying to query by not existing property LinkModel.q" database errors.
    // This middleware uses a whitelist approach: only routes explicitly listed
    // as supporting search will receive the 'q' parameter.
    {
      matcher: "/admin/**",
      method: "GET",
      middlewares: [stripQueryParamForAdminMiddleware],
    },
    // Also strip from vendor routes that might receive search queries
    {
      matcher: "/vendor/**",
      method: "GET",
      middlewares: [stripQueryParamForAdminMiddleware],
    },
    // Also strip from store routes that might receive unexpected 'q' params
    {
      matcher: "/store/**",
      method: "GET",
      middlewares: [stripQueryParamForAdminMiddleware],
    },
    // Block vendor access to API key management endpoints
    // Vendors should not be able to create, read, update, or delete API keys
    {
      matcher: "/vendor/api-keys",
      middlewares: [
        (req: MedusaRequest, res: MedusaResponse) => {
          res.status(403).json({
            message: "Vendors do not have access to API key management",
            type: "forbidden",
          });
        },
      ],
    },
    {
      matcher: "/vendor/api-keys/**",
      middlewares: [
        (req: MedusaRequest, res: MedusaResponse) => {
          res.status(403).json({
            message: "Vendors do not have access to API key management",
            type: "forbidden",
          });
        },
      ],
    },
    // Ensure all vendor routes (including nested plugin routes) are guarded
    {
      matcher: "/vendor/**",
      middlewares: [vendorCorsMiddleware, ensureSellerContext],
    },
    // CORS for auth seller registration status (uses vendor CORS since it's called by vendor panel)
    {
      matcher: "/auth/seller/registration-status",
      middlewares: [vendorCorsMiddleware],
    },
    // CORS for seller registration request (vendor panel signup)
    {
      matcher: "/auth/seller/register-request",
      middlewares: [vendorCorsMiddleware],
    },
    // CORS for custom admin routes (requests, sellers, etc.)
    {
      matcher: "/admin/requests*",
      middlewares: [adminCorsMiddleware],
    },
    {
      matcher: "/admin/sellers*",
      middlewares: [adminCorsMiddleware],
    },
    {
      matcher: "/admin/backfill-seller-auth",
      middlewares: [
        adminCorsMiddleware,
        authenticate("user", ["bearer", "session"]),
      ],
    },
    {
      matcher: "/admin/auth-debug",
      middlewares: [
        adminCorsMiddleware,
        authenticate("user", ["bearer", "session"]),
      ],
    },
    // Apply security headers to all routes
    {
      matcher: "/*",
      middlewares: [securityHeadersMiddleware],
    },
    // Product feed - public XML feed for Google Shopping/Facebook
    {
      matcher: "/product-feed",
      method: "GET",
      middlewares: [validateAndTransformQuery(productFeedQuerySchema, {})],
    },
    // Vendor seller routes - normalize email and rate limit to prevent spam
    {
      matcher: "/vendor/sellers",
      method: "POST",
      middlewares: [vendorRegistrationRateLimiter, normalizeEmailMiddleware],
    },
    // Vendor registration endpoint - dedicated route for seller registration
    // This avoids conflicts with MercurJS's /vendor/sellers route validation
    {
      matcher: "/vendor/register",
      method: "POST",
      middlewares: [vendorRegistrationRateLimiter, normalizeEmailMiddleware],
    },
    // Auth write routes - login and register (tighter rate limit)
    {
      matcher: "/auth/*",
      method: "POST",
      middlewares: [authRateLimiter, normalizeEmailMiddleware],
    },
    // Auth read routes - session checks, status reads (generous rate limit)
    {
      matcher: "/auth/*",
      method: "GET",
      middlewares: [authSessionRateLimiter],
    },
    {
      matcher: "/auth/seller/emailpass",
      method: "POST",
      middlewares: [validatePasswordMiddleware],
    },
    // Password reset - stricter rate limit
    {
      matcher: "/auth/*/reset-password",
      method: "POST",
      middlewares: [strictAuthRateLimiter, normalizeEmailMiddleware],
    },
    // Password update - prevent password reuse
    {
      matcher: "/auth/*/emailpass/update",
      method: "POST",
      middlewares: [preventPasswordReuseMiddleware],
    },
    // Store customer routes
    {
      matcher: "/store/customers",
      middlewares: [authRateLimiter, normalizeEmailMiddleware],
    },
    // Admin user routes
    {
      matcher: "/admin/users",
      middlewares: [normalizeEmailMiddleware],
    },
    // Admin invite routes
    {
      matcher: "/admin/invites",
      middlewares: [normalizeEmailMiddleware],
    },
    // Vendor registration status - handles its own token verification to support pending users
    // (removed middleware - endpoint uses AUTHENTICATE = false and verifies token manually)
    // Vendor sellers/me route - seller authentication for profile access
    {
      matcher: "/vendor/sellers/me",
      middlewares: [authenticate("seller", "bearer")],
    },
    {
      matcher: "/vendor/sellers/me",
      method: "POST",
      middlewares: [validateAndTransformBody(PostVendorSellersMeBodySchema)],
    },
    {
      matcher: "/vendor/sellers/me/extensions",
      middlewares: [authenticate("seller", "bearer")],
    },
    {
      matcher: "/vendor/sellers/me/extensions",
      method: "POST",
      middlewares: [
        validateAndTransformBody(PostVendorSellerExtensionsBodySchema),
      ],
    },
    {
      matcher: "/vendor/me",
      middlewares: [authenticate("seller", "bearer")],
    },
    {
      matcher: "/vendor/hermes/runtime",
      middlewares: [authenticate("seller", "bearer")],
    },
    {
      matcher: "/vendor/hermes/runtime",
      method: "POST",
      middlewares: [
        validateAndTransformBody(PostVendorHermesRuntimeBodySchema),
      ],
    },
    // Vendor delivery routes - seller authentication
    {
      matcher: "/vendor/deliveries/*",
      middlewares: [authenticate("seller", "bearer")],
    },
    {
      matcher: "/vendor/delivery-zones/*",
      middlewares: [authenticate("seller", "bearer")],
    },
    // Phase 1 rollout: runtime module gates
    {
      matcher: "/vendor/pos/*",
      middlewares: [requireFeatureFlagMiddleware("POS_V1")],
    },
    {
      matcher: "/vendor/products/*/weight-pricing",
      middlewares: [requireFeatureFlagMiddleware("WEIGHT_PRICING_V1")],
      method: "POST",
    },
    {
      matcher: "/store/delivery-batches*",
      middlewares: [requireFeatureFlagMiddleware("PICK_PACK_V1")],
    },
    {
      matcher: "/vendor/hawala/payments*",
      middlewares: [requireFeatureFlagMiddleware("INVOICING_V1")],
    },
    {
      matcher: "/vendor/woocommerce/*",
      middlewares: [requireFeatureFlagMiddleware("CHANNEL_SYNC_V1")],
    },
    // Phase 0 contracts: executable JSON boundaries on route payloads
    {
      matcher: "/vendor/inventory-sync/events",
      method: "POST",
      middlewares: [
        requireFeatureFlagMiddleware("CHANNEL_SYNC_V1"),
        validateAndTransformBody(PostInventorySyncEventBody),
      ],
    },
    {
      matcher: "/vendor/products/:id/weight-pricing",
      method: "POST",
      middlewares: [
        requireFeatureFlagMiddleware("WEIGHT_PRICING_V1"),
        validateAndTransformBody(PostWeightPricingRuleBody),
      ],
    },
    {
      matcher: "/vendor/pick-pack/batches",
      method: "POST",
      middlewares: [
        requireFeatureFlagMiddleware("PICK_PACK_V1"),
        validateAndTransformBody(PostPickPackBatchBody),
      ],
    },
    {
      matcher: "/vendor/invoices",
      method: "POST",
      middlewares: [
        requireFeatureFlagMiddleware("INVOICING_V1"),
        validateAndTransformBody(PostInvoiceBody),
      ],
    },
    // Driver routes - driver authentication
    {
      matcher: "/driver/*",
      middlewares: [authenticate("driver", "bearer")],
    },
    // Courier routes for food distribution
    {
      matcher: "/store/couriers/me/*",
      middlewares: [authenticate("customer", ["bearer", "session"])],
    },
    // Store subscription routes - customer authentication
    {
      matcher: "/store/subscriptions",
      middlewares: [authenticate("customer", ["bearer", "session"])],
    },
    {
      matcher: "/store/subscriptions/*",
      middlewares: [authenticate("customer", ["bearer", "session"])],
    },
    // Vendor subscription routes - seller authentication
    {
      matcher: "/vendor/subscriptions",
      middlewares: [authenticate("seller", "bearer")],
    },
    {
      matcher: "/vendor/subscriptions/*",
      middlewares: [authenticate("seller", "bearer")],
    },
    // Vendor requests routes - seller authentication
    {
      matcher: "/vendor/requests",
      middlewares: [authenticate("seller", "bearer")],
    },
    {
      matcher: "/vendor/requests/*",
      middlewares: [authenticate("seller", "bearer")],
    },
    // Rental routes - admin
    {
      matcher: "/admin/products/:id/rental-config",
      method: "POST",
      middlewares: [validateAndTransformBody(PostRentalConfigBodySchema)],
    },
    {
      matcher: "/admin/rentals/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(PostRentalStatusBodySchema)],
    },
    // Rental routes - store
    {
      matcher: "/store/products/:id/rental-availability",
      method: "GET",
      middlewares: [validateAndTransformQuery(GetRentalAvailabilitySchema, {})],
    },
    {
      matcher: "/store/carts/:id/line-items/rentals",
      method: "POST",
      middlewares: [validateAndTransformBody(PostCartItemsRentalsBody)],
    },
    // Ticket booking routes - admin venues
    {
      matcher: "/admin/venues",
      method: "POST",
      middlewares: [validateAndTransformBody(CreateVenueSchema)],
    },
    // Ticket booking routes - admin ticket products
    {
      matcher: "/admin/ticket-products",
      method: "POST",
      middlewares: [validateAndTransformBody(CreateTicketProductSchema)],
    },
    // Ticket booking routes - store seat map
    {
      matcher: "/store/ticket-products/:id/seats",
      method: "GET",
      middlewares: [validateAndTransformQuery(GetTicketProductSeatsSchema, {})],
    },
  ],
});
