import { LaunchWizard } from "../../components/onboarding"

/**
 * Sprint A launch-first onboarding wizard. The legacy multi-vendor
 * `OnboardingWizard` remains available via the components barrel for
 * backwards compatibility, but new vendors hit the launch wizard.
 */
export const Onboarding = () => {
  return <LaunchWizard />
}

export default Onboarding
