import type { ZodType } from "zod"
import { USE_MOCK_DATA, mockResolve, api } from "./api"

// ---------------------------------------------------------------------------
// Mock↔backend data seam.
//
// While USE_MOCK_DATA is true (the default until VITE_USE_MOCK_DATA=false),
// portal hooks resolve from the typed mock layer. When it flips, the real
// `/vendor/**` response must actually match the domain type the UI assumes —
// so validate it at the boundary rather than trusting `data as T`.
//
// Reference flip pattern (see creator-portal/src/hooks/useCreatorData.ts for the
// live example), expressed once here so every hook can adopt it uniformly:
//
//   const DashboardSchema = z.object({ ... })            // mirrors DashboardSummary
//   export function useDashboard() {
//     return useQuery({
//       queryKey: ["wellness", "dashboard"],
//       queryFn: () =>
//         fetchResource("/vendor/wellness/dashboard-summary", DashboardSchema, {
//           mock: MOCK_DASHBOARD,
//           pick: (d) => d.summary,
//         }),
//     })
//   }
// ---------------------------------------------------------------------------

/** Validate an already-fetched payload against a schema (throws on mismatch). */
export function parseResponse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data)
}

export interface FetchResourceOptions<TResponse, TResult> {
  /** Mock value returned while USE_MOCK_DATA is on. */
  mock: TResult
  /** Narrow the validated response envelope to the value the hook returns. */
  pick?: (response: TResponse) => TResult
}

/**
 * Resolve a resource through the seam: return the typed mock while
 * USE_MOCK_DATA is on, otherwise GET the path, validate the JSON against
 * `schema`, and (optionally) pick the value out of the envelope.
 */
export async function fetchResource<TResponse, TResult = TResponse>(
  path: string,
  schema: ZodType<TResponse>,
  options: FetchResourceOptions<TResponse, TResult>
): Promise<TResult> {
  if (USE_MOCK_DATA) {
    return mockResolve(options.mock)
  }
  const { data } = await api.get(path)
  const parsed = parseResponse(schema, data)
  return options.pick
    ? options.pick(parsed)
    : (parsed as unknown as TResult)
}
