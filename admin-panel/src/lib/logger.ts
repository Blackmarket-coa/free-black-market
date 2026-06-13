type LoggerArgs = Parameters<typeof console.log>

const isProduction = process.env.NODE_ENV === "production"

/**
 * Gated logger for the admin panel.
 *
 * `info`/`debug` are silenced in production builds; `warn`/`error` always emit.
 * Centralizes console usage so log output is consistent and can be tuned in one
 * place (see audit-debt item LG-3).
 */
export const logger = {
  info: (...args: LoggerArgs) => {
    if (!isProduction) {
      console.info(...args)
    }
  },
  warn: (...args: LoggerArgs) => {
    console.warn(...args)
  },
  error: (...args: LoggerArgs) => {
    console.error(...args)
  },
  debug: (...args: LoggerArgs) => {
    if (!isProduction) {
      console.debug(...args)
    }
  },
}
