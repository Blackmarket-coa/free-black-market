/**
 * Imported FIRST by a spec that runs the live renewal path:
 * `renew-subscription.ts` reads FBM_SUBSCRIPTION_RENEWAL_LIVE once, when the
 * workflow is composed, so it has to be set before anything loads that file.
 * The spec deletes it again in `afterAll`.
 */
process.env.FBM_SUBSCRIPTION_RENEWAL_LIVE = "1"

export {}
