import { createLogger } from "../../shared/logger"
const log = createLogger("links/utils/load-seller-module")
/**
 * Utility to load the MercurJS SellerModule
 *
 * MercurJS exports the SellerModule from different paths depending on the version.
 * This utility tries multiple paths and provides detailed logging for debugging.
 *
 * Usage:
 *   import { loadSellerModule } from "./utils/load-seller-module"
 *   const { SellerModule, error } = loadSellerModule("my-link")
 */

interface LoadResult {
  SellerModule: any
  error: string | null
  source: string | null
}

/**
 * Load the MercurJS SellerModule from available paths
 * @param linkName - Name of the link for logging purposes
 * @returns Object with SellerModule (or null), error message, and source path
 */
export function loadSellerModule(linkName: string): LoadResult {
  const LOG_PREFIX = `[Link: ${linkName}]`

  // Try @mercurjs/framework first (newer versions)
  try {
    const SellerModule = require("@mercurjs/framework").SellerModule
    if (SellerModule) {
      log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/framework`)
      return { SellerModule, error: null, source: "@mercurjs/framework" }
    }
  } catch (_e: any) {
    // Continue to next attempt
  }

  // Try @mercurjs/b2c-core/modules/seller (standard path)
  try {
    const SellerModule = require("@mercurjs/b2c-core/modules/seller").default
    if (SellerModule) {
      log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/b2c-core/modules/seller`)
      return { SellerModule, error: null, source: "@mercurjs/b2c-core/modules/seller" }
    }
  } catch (_e: any) {
    // Continue to next attempt
  }

  // Try @mercurjs/b2c-core direct import
  try {
    const b2cCore = require("@mercurjs/b2c-core")
    if (b2cCore.SellerModule) {
      log.info(`${LOG_PREFIX} Loaded SellerModule from @mercurjs/b2c-core`)
      return { SellerModule: b2cCore.SellerModule, error: null, source: "@mercurjs/b2c-core" }
    }
  } catch (_e: any) {
    // Continue to error handling
  }

  // All attempts failed
  const error = `
    ${LOG_PREFIX} Failed to load MercurJS SellerModule.
    Attempted paths:
      - @mercurjs/framework (SellerModule export)
      - @mercurjs/b2c-core/modules/seller (default export)
      - @mercurjs/b2c-core (SellerModule export)

    Ensure @mercurjs/b2c-core is installed and configured in medusa-config.ts.
    Links requiring SellerModule will not be created.
  `.trim()

  log.error(error)
  return { SellerModule: null, error, source: null }
}

/**
 * Verify that a module has the expected linkable property
 * @param module - The module to check
 * @param linkableName - The name of the linkable (e.g., "seller", "producer")
 * @returns True if the linkable exists
 */
export function hasLinkable(module: any, linkableName: string): boolean {
  return module?.linkable?.[linkableName] !== undefined
}
