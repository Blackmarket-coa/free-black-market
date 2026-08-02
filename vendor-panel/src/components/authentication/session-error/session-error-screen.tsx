import { Button, Heading, Text } from "@medusajs/ui"
import AvatarBox from "../../common/logo-box/avatar-box"
import { useLogout } from "../../../hooks/api/auth"
import { clearAuthToken } from "../../../lib/client"

/**
 * Shown when the seller session can't be loaded for a reason a fresh login
 * would NOT fix (seller profile missing, server error, network failure).
 * Offers retry / logout / support instead of bouncing back to `/login`.
 */
export const SessionErrorScreen = ({
  message,
  status,
  onRetry,
  isRetrying,
}: {
  message?: string
  status?: number
  onRetry: () => void
  isRetrying: boolean
}) => {
  const { mutate: logout, isPending: isLoggingOut } = useLogout()

  const handleLogout = () => {
    logout(undefined, {
      onSuccess: () => {
        clearAuthToken()
        window.location.href = "/login"
      },
      onError: () => {
        clearAuthToken()
        window.location.href = "/login"
      },
    })
  }

  const fallbackMessage =
    status === 404
      ? "We couldn't find the seller profile linked to your account."
      : "We couldn't load your seller account right now."

  return (
    <div className="bg-ui-bg-subtle flex min-h-dvh w-dvw items-center justify-center">
      <div className="m-4 flex flex-col items-center max-w-md">
        <AvatarBox />

        <div className="bg-ui-tag-orange-bg mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <svg
            className="text-ui-tag-orange-icon h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86l-8.02 13.89A1.5 1.5 0 003.57 20h16.86a1.5 1.5 0 001.3-2.25L13.71 3.86a1.5 1.5 0 00-2.6 0z"
            />
          </svg>
        </div>

        <Heading>We hit a snag loading your account</Heading>
        <Text
          size="small"
          className="text-ui-fg-subtle mt-2 max-w-[340px] text-center"
        >
          {message || fallbackMessage} Your login worked — this is a problem on
          our side, so signing in again won't change it.
        </Text>

        <div className="mt-8 flex flex-col items-center gap-4">
          <Button onClick={onRetry} isLoading={isRetrying}>
            Try again
          </Button>

          <Button
            variant="transparent"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "Logging out..." : "Log out"}
          </Button>

          <Text size="xsmall" className="text-ui-fg-muted mt-2 text-center">
            Still stuck?{" "}
            <a
              href="mailto:support@freeblackmarket.com"
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
            >
              Contact Support
            </a>
          </Text>
        </div>
      </div>
    </div>
  )
}
