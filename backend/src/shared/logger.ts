/**
 * Structured Logger for FreeBlackMarket.com
 * 
 * Provides consistent logging with levels, prefixes, and JSON output for production.
 * 
 * @example
 * ```typescript
 * import { logger, createLogger } from "../shared/logger"
 * 
 * // Use default logger
 * logger.info("Server started")
 * 
 * // Create module-specific logger
 * const log = createLogger("Subscription")
 * log.info("Processing renewal", { subscriptionId: "sub_123" })
 * ```
 */

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogContext {
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  prefix: string
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LOG_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // Cyan
  info: "\x1b[32m",  // Green
  warn: "\x1b[33m",  // Yellow
  error: "\x1b[31m", // Red
}

const RESET_COLOR = "\x1b[0m"

/**
 * Get log level from environment variable
 * Supports: debug, info, warn, error
 */
function getLogLevelFromEnv(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase()
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel
  }
  // Default: debug in development, info in production
  return process.env.NODE_ENV === "production" ? "info" : "debug"
}

/**
 * Coerce an arbitrary first argument (this logger accepts a console-compatible
 * variadic signature) into a human-readable message string.
 */
function coerceMessage(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.message
  if (value === undefined) return ""
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value)
  } catch {
    return String(value)
  }
}

/**
 * Fold the trailing console-style arguments into a structured context object and,
 * for error logging, surface the first Error. Plain objects are merged; primitives
 * and arrays are collected under `args`.
 */
function collectArgs(rest: unknown[]): { context?: LogContext; error?: Error } {
  let error: Error | undefined
  const extras: unknown[] = []
  const merged: LogContext = {}
  for (const item of rest) {
    if (item instanceof Error && !error) {
      error = item
      continue
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(merged, item as LogContext)
    } else {
      extras.push(item)
    }
  }
  if (extras.length > 0) {
    merged.args = extras.length === 1 ? extras[0] : extras
  }
  const context = Object.keys(merged).length > 0 ? merged : undefined
  return { context, error }
}

class Logger {
  private prefix: string
  private minLevel: LogLevel
  private isProduction: boolean

  constructor(prefix = "FBM", minLevel?: LogLevel) {
    this.prefix = prefix
    this.isProduction = process.env.NODE_ENV === "production"
    this.minLevel = minLevel || getLogLevelFromEnv()
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel]
  }

  private formatEntry(level: LogLevel, message: string, context?: LogContext, error?: Error): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      prefix: this.prefix,
      message,
      ...(context && Object.keys(context).length > 0 && { context }),
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
    }
  }

  private output(level: LogLevel, entry: LogEntry): void {
    if (this.isProduction) {
      // JSON output for production (structured logging for log aggregators)
      const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log
      consoleMethod(JSON.stringify(entry))
    } else {
      // Pretty output for development
      const color = LOG_COLORS[level]
      const levelStr = level.toUpperCase().padEnd(5)
      const prefix = `[${this.prefix}]`
      const timestamp = entry.timestamp.split("T")[1].split(".")[0] // HH:MM:SS
      
      let output = `${color}${levelStr}${RESET_COLOR} ${timestamp} ${prefix} ${entry.message}`
      
      if (entry.context) {
        output += ` ${JSON.stringify(entry.context)}`
      }
      
      if (entry.error) {
        output += `\n  Error: ${entry.error.message}`
        if (entry.error.stack) {
          output += `\n${entry.error.stack.split("\n").slice(1, 4).join("\n")}`
        }
      }
      
      const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log
      consoleMethod(output)
    }
  }

  debug(message?: unknown, ...rest: unknown[]): void {
    if (this.shouldLog("debug")) {
      const { context } = collectArgs(rest)
      this.output("debug", this.formatEntry("debug", coerceMessage(message), context))
    }
  }

  info(message?: unknown, ...rest: unknown[]): void {
    if (this.shouldLog("info")) {
      const { context } = collectArgs(rest)
      this.output("info", this.formatEntry("info", coerceMessage(message), context))
    }
  }

  warn(message?: unknown, ...rest: unknown[]): void {
    if (this.shouldLog("warn")) {
      const { context } = collectArgs(rest)
      this.output("warn", this.formatEntry("warn", coerceMessage(message), context))
    }
  }

  error(message?: unknown, ...rest: unknown[]): void {
    if (this.shouldLog("error")) {
      // A leading Error (e.g. `log.error(err)`) is promoted to the structured error field.
      const leadError = message instanceof Error ? message : undefined
      const { context, error } = collectArgs(rest)
      this.output(
        "error",
        this.formatEntry("error", coerceMessage(message), context, error ?? leadError)
      )
    }
  }

  /**
   * Create a child logger with a sub-prefix
   */
  child(subPrefix: string): Logger {
    return new Logger(`${this.prefix}:${subPrefix}`, this.minLevel)
  }
}

// Default logger instance
export const logger = new Logger("FBM")

/**
 * Create a module-specific logger
 * 
 * @example
 * ```typescript
 * const log = createLogger("Subscription")
 * log.info("Processing renewal")
 * // Output: [FBM:Subscription] Processing renewal
 * ```
 */
export function createLogger(module: string): Logger {
  return logger.child(module)
}

// Pre-configured loggers for common modules
export const loggers = {
  api: createLogger("API"),
  auth: createLogger("Auth"),
  subscription: createLogger("Subscription"),
  delivery: createLogger("Delivery"),
  hawala: createLogger("Hawala"),
  notification: createLogger("Notification"),
  workflow: createLogger("Workflow"),
  job: createLogger("Job"),
}
