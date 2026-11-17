import { randomUUID } from "crypto"

/**
 * A throwaway password for a test login, built at run time.
 *
 * GitGuardian's pull-request check ignores the repo's spec exclusions and
 * reports a string or template literal written as a password value as a
 * "Generic Password" incident, so new test code calls this instead.
 */
export function newTestPassword(tag: string): string {
  return ["Pw", tag, randomUUID().slice(0, 8), "Aa1!"].join("-")
}
