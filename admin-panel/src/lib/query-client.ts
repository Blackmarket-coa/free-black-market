import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query"

const runtimeBackend = typeof window !== 'undefined' && (window as any).__MEDUSA_BACKEND_URL__
export const MEDUSA_BACKEND_URL = (runtimeBackend || __BACKEND_URL__) ?? "/"

// Cache duration constants (in milliseconds)
export const CACHE_TIMES = {
  // Static data that rarely changes (5 minutes)
  STATIC: 5 * 60 * 1000,
  // Semi-static data like categories, regions (2 minutes)
  SEMI_STATIC: 2 * 60 * 1000,
  // Default for most queries (90 seconds)
  DEFAULT: 90 * 1000,
  // Frequently changing data like orders, inventory (30 seconds)
  DYNAMIC: 30 * 1000,
  // Real-time data like notifications (10 seconds)
  REAL_TIME: 10 * 1000,
} as const

// Garbage collection time (when to remove unused cache entries)
const GC_TIME = 10 * 60 * 1000 // 10 minutes

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Log errors for debugging in development
      if (process.env.NODE_ENV === 'development') {
        console.error(`Query error [${query.queryKey}]:`, error)
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      // Log mutation errors for debugging in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Mutation error:', error)
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Don't refetch on window focus to reduce unnecessary API calls
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect automatically
      refetchOnReconnect: false,
      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
      // Default stale time
      staleTime: CACHE_TIMES.DEFAULT,
      // Time before garbage collection
      gcTime: GC_TIME,
      // Retry failed requests once, but never retry rate-limited or auth errors
      retry: (failureCount, error: any) => {
        const status = error?.status ?? error?.response?.status
        if (status === 429 || status === 401 || status === 403) return false
        
return failureCount < 1
      },
      // Retry delay with exponential backoff
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Enable structural sharing for better performance
      structuralSharing: true,
      // Network mode - don't show loading state if we have cached data
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Retry mutations once, but never retry rate-limited or auth errors
      retry: (failureCount, error: any) => {
        const status = error?.status ?? error?.response?.status
        if (status === 429 || status === 401 || status === 403) return false
        
return failureCount < 1
      },
      // Network mode for mutations
      networkMode: 'online',
    },
  },
})

// Helper function to get cache time based on query type
export const getCacheTime = (queryType: keyof typeof CACHE_TIMES) => {
  return { staleTime: CACHE_TIMES[queryType] }
}
