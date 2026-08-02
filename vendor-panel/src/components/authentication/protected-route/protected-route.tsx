import { Spinner } from "@medusajs/icons"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useSellerSession } from "../../../hooks/api/users"
import { SearchProvider } from "../../../providers/search-provider"
import { SidebarProvider } from "../../../providers/sidebar-provider"
import { MatrixProvider } from "../../../providers/matrix-provider"
import { clearAuthToken, getAuthToken } from "../../../lib/client"
import {
  SessionFetchError,
  classifySessionError,
} from "../../../lib/session-error"
import { SessionErrorScreen } from "../session-error/session-error-screen"

export const ProtectedRoute = () => {
  const location = useLocation()
  const hasToken = Boolean(getAuthToken())

  const {
    session,
    isPending: isSessionPending,
    isFetching: isSessionFetching,
    error,
    refetch,
  } = useSellerSession({
    enabled: hasToken,
  })

  // If no token, redirect to login immediately
  if (!hasToken) {
    return (
      <Navigate
        to="/login"
        state={{ from: location }}
        replace
      />
    )
  }

  // Show loading while checking registration status
  if (isSessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ui-fg-interactive animate-spin" />
      </div>
    )
  }

  const registrationStatus = session?.registration_status
  const seller = session?.seller

  if (error && !registrationStatus) {
    const sessionError = error as SessionFetchError

    if (classifySessionError(sessionError) === "reauthenticate") {
      // The token itself is bad (expired/invalid) — drop it so the next
      // login starts clean instead of re-entering this loop with a stale
      // token still in storage.
      clearAuthToken()
      return (
        <Navigate
          to={`/login?reason=${encodeURIComponent(error.message)}`}
          state={{ from: location }}
          replace
        />
      )
    }

    // 404/5xx/network: re-authenticating can't fix these — sending the user
    // back to /login just produced a login loop. Show an actionable screen.
    return (
      <SessionErrorScreen
        message={sessionError.message}
        status={sessionError.status}
        onRetry={() => refetch()}
        isRetrying={isSessionFetching}
      />
    )
  }

  // Handle different registration statuses
  if (registrationStatus) {
    switch (registrationStatus.status) {
      case "pending":
      case "rejected":
      case "cancelled":
      case "no_request":
        // Redirect to pending-approval page for non-approved states
        return <Navigate to="/pending-approval" replace />

      case "unauthenticated":
        // Token is invalid or expired — drop it so the next login is clean
        clearAuthToken()
        return (
          <Navigate
            to="/login"
            state={{ from: location }}
            replace
          />
        )

      case "approved":
        if (!registrationStatus.seller_id) {
          return <Navigate to="/pending-approval" replace />
        }
        // Continue to load seller data below when seller is available
        break

      default:
        // Unknown status - show pending page with error info
        return <Navigate to="/pending-approval" replace />
    }
  }

  // Approval succeeded but the seller payload is missing — an edge case a
  // fresh login can't fix, so surface the actionable error screen instead of
  // bouncing to /login with the token still stored (that read as a loop).
  if (!seller) {
    return (
      <SessionErrorScreen
        message={registrationStatus?.message}
        onRetry={() => refetch()}
        isRetrying={isSessionFetching}
      />
    )
  }

  // User is approved and seller data is loaded - render the protected content
  return (
    <MatrixProvider>
      <SidebarProvider>
        <SearchProvider>
          <Outlet />
        </SearchProvider>
      </SidebarProvider>
    </MatrixProvider>
  )
}
