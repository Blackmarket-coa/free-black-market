import { Spinner } from "@medusajs/icons"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useSellerSession } from "../../../hooks/api/users"
import { SearchProvider } from "../../../providers/search-provider"
import { SidebarProvider } from "../../../providers/sidebar-provider"
import { MatrixProvider } from "../../../providers/matrix-provider"
import { getAuthToken } from "../../../lib/client"

export const ProtectedRoute = () => {
  const location = useLocation()
  const hasToken = Boolean(getAuthToken())

  const {
    session,
    isPending: isSessionPending,
    error,
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
    return (
      <Navigate
        to={`/login?reason=${encodeURIComponent(error.message)}`}
        state={{ from: location }}
        replace
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
        // Token is invalid or expired
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

  // If we have an error or no seller after approval status, redirect to login
  // This handles edge cases where approval succeeded but seller fetch fails
  if (!seller) {
    return (
      <Navigate
        to={`/login${registrationStatus?.message ? `?reason=${registrationStatus.message}` : ""}`}
        state={{ from: location }}
        replace
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
