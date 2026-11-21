import { Button, Heading, Text } from "@medusajs/ui"
import { Link, Navigate } from "react-router-dom"
import AvatarBox from "../../components/common/logo-box/avatar-box"
import { useLogout } from "../../hooks/api/auth"
import { useRegistrationStatus } from "../../hooks/api/users"
import { Spinner } from "@medusajs/icons"
import { clearAuthToken } from "../../lib/client"
import {
  isTokenRefreshFailure,
  storedTokenWasRefused,
} from "../../lib/seller-token"

/**
 * Pending Approval Page
 *
 * Shown to users who have registered but are waiting for admin approval.
 * This prevents the login loop that occurs when a user has a valid auth token
 * but no approved seller account linked to it.
 */
export const PendingApproval = () => {
  const { registrationStatus, isPending, error, refetch } =
    useRegistrationStatus()
  const { mutate: logout, isPending: isLoggingOut } = useLogout()

  const handleLogout = () => {
    logout(undefined, {
      onSuccess: () => {
        clearAuthToken()
        window.location.href = "/login"
      },
      onError: () => {
        // Force logout even on error
        clearAuthToken()
        window.location.href = "/login"
      },
    })
  }

  const handleRefresh = () => {
    refetch()
  }

  // Show loading state
  if (isPending) {
    return (
      <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center">
        <Spinner className="text-ui-fg-interactive animate-spin" />
      </div>
    )
  }

  // Approved, but the token stored at sign-up names no store and the one
  // refresh did not replace it (lib/seller-token.ts): every /vendor call would
  // answer 403, so the vendor signs in again, told why. Only for the token
  // that failed: the error outlives it on the cached query.
  if (isTokenRefreshFailure(error) && storedTokenWasRefused()) {
    clearAuthToken()
    return (
      <Navigate
        to={`/login?reason=${encodeURIComponent(error.message)}`}
        replace
      />
    )
  }

  // If user is approved and linked to a seller, redirect to dashboard
  if (registrationStatus?.status === "approved" && registrationStatus.seller_id) {
    return <Navigate to="/dashboard" replace />
  }

  // If user is not authenticated, redirect to login
  if (registrationStatus?.status === "unauthenticated") {
    return <Navigate to="/login" replace />
  }

  // Render appropriate content based on status
  const renderContent = () => {
    if (registrationStatus?.status === "approved" && !registrationStatus.seller_id) {
      return (
        <>
          <div className="w-16 h-16 rounded-full bg-ui-tag-blue-bg flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-ui-tag-blue-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <Heading>Account Linking In Progress</Heading>
          <Text size="small" className="text-ui-fg-subtle text-center mt-2 max-w-[320px]">
            Your seller account has been approved, but we are still linking it to your profile.
            Please refresh in a moment or log out and log back in.
          </Text>
        </>
      )
    }

    switch (registrationStatus?.status) {
      case "pending":
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-ui-tag-orange-bg flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-ui-tag-orange-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <Heading>Pending Approval</Heading>
            <Text size="small" className="text-ui-fg-subtle text-center mt-2 max-w-[320px]">
              Your seller registration is being reviewed by our team. You will receive an email once your account has been approved.
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted text-center mt-4 max-w-[280px]">
              This usually takes 1-2 business days. If you have questions, please contact support.
            </Text>
          </>
        )

      case "rejected":
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-ui-tag-red-bg flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-ui-tag-red-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <Heading>Registration Not Approved</Heading>
            <Text size="small" className="text-ui-fg-subtle text-center mt-2 max-w-[320px]">
              Unfortunately, your seller registration was not approved.
            </Text>
            {registrationStatus.reviewer_note && (
              <div className="bg-ui-bg-component p-3 rounded-lg mt-4 max-w-[320px]">
                <Text size="xsmall" className="text-ui-fg-muted">
                  Note: {registrationStatus.reviewer_note}
                </Text>
              </div>
            )}
            <Text size="small" className="text-ui-fg-subtle text-center mt-4 max-w-[320px]">
              You can apply again with the same email and password, for
              example after changing what the note asks for.
            </Text>
            <Link to="/register" className="mt-4">
              <Button>Apply again</Button>
            </Link>
            <Text size="xsmall" className="text-ui-fg-muted text-center mt-4 max-w-[280px]">
              Please contact support if you believe this is an error or would like more information.
            </Text>
          </>
        )

      case "cancelled":
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-ui-tag-neutral-bg flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-ui-tag-neutral-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <Heading>Registration Cancelled</Heading>
            <Text size="small" className="text-ui-fg-subtle text-center mt-2 max-w-[320px]">
              Your seller registration has been cancelled. You may submit a new registration if you wish to join as a seller.
            </Text>
            <Link to="/register" className="mt-4">
              <Button>Apply again</Button>
            </Link>
          </>
        )

      case "no_request":
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-ui-tag-blue-bg flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-ui-tag-blue-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <Heading>Registration Incomplete</Heading>
            <Text size="small" className="text-ui-fg-subtle text-center mt-2 max-w-[320px]">
              It looks like your seller registration is incomplete. Please complete the registration process to submit your application.
            </Text>
            <Link to="/register" className="mt-6">
              <Button>Complete Registration</Button>
            </Link>
          </>
        )

      default:
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-ui-tag-neutral-bg flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-ui-tag-neutral-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <Heading>Unknown Status</Heading>
            <Text size="small" className="text-ui-fg-subtle text-center mt-2 max-w-[320px]">
              We couldn't determine the status of your registration. Please try refreshing or contact support.
            </Text>
          </>
        )
    }
  }

  return (
    <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center">
      <div className="m-4 flex flex-col items-center max-w-md">
        <AvatarBox />

        {renderContent()}

        <div className="flex flex-col items-center gap-4 mt-8">
          {(registrationStatus?.status === "pending" ||
            (registrationStatus?.status === "approved" && !registrationStatus.seller_id)) && (
            <Button variant="secondary" onClick={handleRefresh} disabled={isPending}>
              Check Status
            </Button>
          )}

          <Button variant="transparent" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? "Logging out..." : "Log out"}
          </Button>

          {registrationStatus?.status !== "no_request" && (
            <Text size="xsmall" className="text-ui-fg-muted text-center mt-2">
              Need help?{" "}
              <a
                href="mailto:support@freeblackmarket.com"
                className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              >
                Contact Support
              </a>
            </Text>
          )}
        </div>
      </div>
    </div>
  )
}
