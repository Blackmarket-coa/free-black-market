/**
 * The backend's own words for a request it refused.
 *
 * `fetchQuery` rejects with `"<message> (POST /vendor/x (400 Bad Request))"`,
 * which is for logs. A vendor is shown what the backend said and nothing
 * else: a listing type their playbook does not allow, a product id that is
 * not theirs, a name another store already uses.
 *
 * The backend answers in two shapes. Medusa's error handler puts the reason
 * in `message`. FBM's own product routes answer
 * `{ message: "Failed to create product", error: "<the reason>" }`, so when
 * both are present both are shown.
 */
type FetchQueryError = {
  message?: unknown
  details?: { backendMessage?: unknown; backendError?: unknown } | null
}

export const backendMessage = (error: unknown, fallback: string): string => {
  const details = (error as FetchQueryError | null)?.details
  const message =
    typeof details?.backendMessage === "string" ? details.backendMessage : ""
  const reason =
    typeof details?.backendError === "string" ? details.backendError : ""

  if (message && reason && reason !== message) {
    return `${message}: ${reason}`
  }
  if (message || reason) {
    return message || reason
  }

  const own = (error as FetchQueryError | null)?.message
  return typeof own === "string" && own.trim() !== "" ? own : fallback
}
