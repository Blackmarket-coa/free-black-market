import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { api, LOGIN_URL, USE_MOCK_DATA } from "./api"

// An authenticated backend route used purely to confirm the browser holds a
// valid session before the dashboard renders. Override per portal/deploy with
// VITE_PORTAL_SESSION_PATH once the portal's own session endpoint exists.
const SESSION_PROBE_PATH =
  (import.meta.env.VITE_PORTAL_SESSION_PATH as string | undefined) ||
  "/vendor/sellers/me"

type Status = "checking" | "authed" | "redirecting"

const screenStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#6b7280",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: "0.95rem",
}

/**
 * Gates a portal behind a real session in production.
 *
 * The portals are producer/seller dashboards (orders, payouts, inventory), so
 * they must not render for an unauthenticated visitor. In mock mode (dev) this
 * renders straight through. In a real (production) build it probes an
 * authenticated backend route first and **fails closed** — redirecting to the
 * FBM login surface rather than exposing the dashboard shell — which is what
 * closes the "full dashboard renders for anyone" hole. Deploys that haven't
 * wired a working session endpoint simply bounce to login (safe) rather than
 * leaking the dashboard.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(
    USE_MOCK_DATA ? "authed" : "checking"
  )

  useEffect(() => {
    if (USE_MOCK_DATA) return
    let cancelled = false
    api
      .get(SESSION_PROBE_PATH)
      .then(() => {
        if (!cancelled) setStatus("authed")
      })
      .catch(() => {
        if (cancelled) return
        // A 401 is already redirected by the api interceptor; handle every
        // other failure (network, 403, 5xx) the same fail-closed way.
        setStatus("redirecting")
        window.location.href = LOGIN_URL
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (status === "authed") {
    return <>{children}</>
  }

  return (
    <div style={screenStyle} role="status" aria-live="polite">
      {status === "redirecting" ? "Redirecting to sign in…" : "Loading…"}
    </div>
  )
}
