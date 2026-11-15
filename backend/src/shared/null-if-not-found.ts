import { MedusaError } from "@medusajs/framework/utils"

/**
 * The looked-up record, or null when there is no such row.
 *
 * Module `retrieveX` methods throw a not-found rather than returning null, so
 * a route that writes `if (!record) return forbidden(res)` after a bare
 * `retrieveX` never reaches its own refusal: the not-found escapes as a 404,
 * and the 404-vs-403 split `forbidden` exists to prevent is back. Only a
 * not-found becomes null; any other failure propagates, so a database outage
 * surfaces as an error rather than as a refusal.
 */
export async function nullIfNotFound<T>(lookup: Promise<T>): Promise<T | null> {
  try {
    return await lookup
  } catch (error) {
    if ((error as { type?: string })?.type === MedusaError.Types.NOT_FOUND) {
      return null
    }
    throw error
  }
}
