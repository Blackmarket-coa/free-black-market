import { LaunchWizard, QuickPath } from "../../components/onboarding"

/**
 * Whether an onboarding address shows the quick path: only when it is
 * switched on, and for every address that does not carry `mode=full`. The
 * quick path's own "Continue to delivery" therefore has to go to an address
 * with `mode=full` (components/onboarding/quick-path.tsx, `QUICK_PATH_NEXT`),
 * or it reloads itself.
 */
export const showsQuickPath = (quickEnabled: boolean, search: string) =>
  quickEnabled && new URLSearchParams(search).get("mode") !== "full"

/**
 * Sprint A launch-first onboarding wizard. The legacy multi-vendor
 * `OnboardingWizard` remains available via the components barrel for
 * backwards compatibility.
 *
 * Slice C (Creator Commerce roadmap) introduces a 60-second `QuickPath`
 * variant. It is the default when `VITE_FBM_QUICK_ONBOARD === "1"` and
 * the URL doesn't carry `?mode=full`. Otherwise the existing 5-step
 * `LaunchWizard` continues to render unchanged.
 */
export const Onboarding = () => {
  const quickEnabled =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_FBM_QUICK_ONBOARD === "1"

  if (
    typeof window !== "undefined" &&
    showsQuickPath(quickEnabled, window.location.search)
  ) {
    return <QuickPath />
  }

  return <LaunchWizard />
}

export default Onboarding
