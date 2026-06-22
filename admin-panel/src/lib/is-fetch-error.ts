import { FetchError } from "@medusajs/js-sdk"

export const isFetchError = (error: unknown): error is FetchError => {
  return error instanceof FetchError
}
