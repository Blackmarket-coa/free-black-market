/**
 * Graceful Shutdown Handler for FreeBlackMarket.com
 * 
 * Handles SIGTERM/SIGINT signals for clean shutdown in containerized environments.
 * Ensures connections are drained and resources are released before exit.
 * 
 * Usage:
 * ```typescript
 * import { registerShutdownHandlers } from "./shared/shutdown"
 * 
 * // Register early in application startup
 * registerShutdownHandlers()
 * ```
 */
import { RedisClientType } from "redis"
import { createLogger } from "./logger"

const logger = createLogger("Shutdown")

interface ShutdownOptions {
  timeout?: number // Maximum time to wait for graceful shutdown (ms)
}

// Track registered cleanup handlers
const cleanupHandlers: Array<() => Promise<void>> = []
let isShuttingDown = false

/**
 * Register a cleanup handler to be called during shutdown
 */
export function onShutdown(handler: () => Promise<void>): void {
  cleanupHandlers.push(handler)
}

/**
 * Remove a previously registered cleanup handler
 */
export function offShutdown(handler: () => Promise<void>): void {
  const index = cleanupHandlers.indexOf(handler)
  if (index > -1) {
    cleanupHandlers.splice(index, 1)
  }
}

/**
 * Perform graceful shutdown
 */
async function performShutdown(signal: string, options: ShutdownOptions = {}): Promise<void> {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress, ignoring signal", { signal })
    return
  }

  isShuttingDown = true
  const timeout = options.timeout || 30000 // 30 second default

  logger.info(`Received ${signal}, starting graceful shutdown...`, { 
    handlersCount: cleanupHandlers.length,
    timeout 
  })

  // Create a timeout promise
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Shutdown timed out after ${timeout}ms`))
    }, timeout)
  })

  // Run all cleanup handlers
  const cleanupPromise = (async () => {
    for (const handler of cleanupHandlers) {
      try {
        await handler()
      } catch (error) {
        logger.error("Cleanup handler failed", { error })
      }
    }
  })()

  try {
    await Promise.race([cleanupPromise, timeoutPromise])
    logger.info("Graceful shutdown completed")
    process.exit(0)
  } catch (error) {
    logger.error("Graceful shutdown failed", { error })
    process.exit(1)
  }
}

/**
 * Register shutdown signal handlers
 * Call this early in application startup
 */
export function registerShutdownHandlers(options: ShutdownOptions = {}): void {
  // SIGTERM - sent by container orchestrators (Railway, K8s, Docker)
  process.on("SIGTERM", () => performShutdown("SIGTERM", options))
  
  // SIGINT - sent by Ctrl+C in terminal
  process.on("SIGINT", () => performShutdown("SIGINT", options))

  // Handle uncaught errors gracefully
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error: error.message, stack: error.stack })
    performShutdown("uncaughtException", options)
  })

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason })
    performShutdown("unhandledRejection", options)
  })

  logger.info("Shutdown handlers registered")
}

/**
 * Create a Redis cleanup handler
 * Automatically closes Redis connections on shutdown
 */
export function createRedisCleanupHandler(client: RedisClientType): () => Promise<void> {
  return async () => {
    logger.info("Closing Redis connection...")
    try {
      await client.quit()
      logger.info("Redis connection closed")
    } catch (error) {
      logger.error("Failed to close Redis connection", { error })
      // Force disconnect if quit fails
      client.disconnect()
    }
  }
}

/**
 * Create a generic database cleanup handler
 * For MikroORM/Knex connections
 */
export function createDatabaseCleanupHandler(
  closeConnection: () => Promise<void>,
  name = "Database"
): () => Promise<void> {
  return async () => {
    logger.info(`Closing ${name} connection...`)
    try {
      await closeConnection()
      logger.info(`${name} connection closed`)
    } catch (error) {
      logger.error(`Failed to close ${name} connection`, { error })
    }
  }
}

/**
 * Create an HTTP server cleanup handler
 * Stops accepting new connections and waits for existing to complete
 */
export function createHttpCleanupHandler(
  server: { close: (callback?: (err?: Error) => void) => void },
  name = "HTTP Server"
): () => Promise<void> {
  return () => new Promise((resolve) => {
    logger.info(`Stopping ${name}...`)
    server.close((err) => {
      if (err) {
        logger.error(`Error stopping ${name}`, { error: err })
      } else {
        logger.info(`${name} stopped`)
      }
      resolve()
    })
  })
}
