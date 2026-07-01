import type { ReactNode } from "react"

// Minimal loading/error wrapper for React Query-backed pages.
export function QueryState({
  isLoading,
  isError,
  children,
}: {
  isLoading: boolean
  isError: boolean
  children: ReactNode
}) {
  if (isLoading) {
    return <div className="text-sm text-mist py-12 text-center">Loading…</div>
  }
  if (isError) {
    return (
      <div className="text-sm text-clay py-12 text-center">
        Couldn’t load data. Check the backend connection.
      </div>
    )
  }
  return <>{children}</>
}
