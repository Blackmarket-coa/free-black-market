import { LaunchWizard, QuickPath } from "../../components/onboarding"

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

  if (quickEnabled && typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search)
    if (params.get("mode") !== "full") {
      return <QuickPath />
    }
  }

  return <LaunchWizard />
}

export default Onboarding
