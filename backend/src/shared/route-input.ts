import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import type { createLogger } from "./logger"

/**
 * Parsing a vendor write's input, and answering its failures, without echoing
 * what was sent or what the database said.
 *
 * The same two rules the farm routes follow (`api/vendor/farm/_access.ts`,
 * SD-156), shared here for the nursery and order-cycle routes (SD-158):
 *
 * - An id is one non-empty string. Ownership is checked with `query.graph`
 *   and module list filters, and a filter given an array reads it as IN, so
 *   `[the store's id, another store's id]` passes a check written for one id.
 * - A route's own 500 names what failed and logs the error. The error's text
 *   can carry the SQL of the statement that failed, and the production error
 *   sanitizer never sees an answer the route sends itself.
 */

/** One record id, from a path or a body. */
export const recordId = z.string().min(1).max(200)

type Res = Pick<MedusaResponse, "status">
type Log = ReturnType<typeof createLogger>

function fieldName(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((name, part) => {
    if (typeof part === "number") return `${name}[${part}]`
    return name ? `${name}.${String(part)}` : String(part)
  }, "")
}

function valueAt(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let value: unknown = input
  for (const part of path) {
    if (value === null || typeof value !== "object") return undefined
    value = (value as Record<PropertyKey, unknown>)[part]
  }
  return value
}

/**
 * Parse a route's input (`req.params` or `req.body`) with `schema`. Anything
 * else answers 400 naming the fields at fault, never what they held. Null
 * means the answer was sent.
 */
export function parseRouteInput<S extends z.ZodType>(res: Res, input: unknown, schema: S): z.output<S> | null {
  const given = input ?? {}
  const parsed = schema.safeParse(given)
  if (parsed.success) return parsed.data
  const problems = new Map<string, string>()
  for (const issue of parsed.error.issues) {
    const name = fieldName(issue.path)
    if (!name) {
      problems.set("", "The request body must be an object")
      continue
    }
    if (!problems.has(name)) {
      problems.set(name, valueAt(given, issue.path) === undefined ? `${name} is required` : `${name} is invalid`)
    }
  }
  const message = problems.get("") ?? [...problems.values()].join("; ")
  res.status(400).json({ message, type: "invalid_data" })
  return null
}

/**
 * A route's 500: what failed, and never the error's own text, which is logged
 * with the method and path instead.
 */
export function routeFailure(log: Log, req: MedusaRequest, res: Res, message: string, error: unknown): void {
  log.error(`${req.method ?? ""} ${req.originalUrl ?? req.url ?? ""}: ${message}`, error)
  res.status(500).json({ message })
}
